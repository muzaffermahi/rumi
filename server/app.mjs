// Rumi's local server: the HTTP API for the interface and the `rumi` command. Routes live in routes/, by area;
// the work happens in the modules next to this one (see ARCHITECTURE.md) and in pi/, Rumi's Pi extension.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {appDir, DEFAULT_PORT, version} from './paths.mjs';
import {guard, writeServerFile} from './auth.mjs';
import * as host from './runtime.mjs';
import {workspaces} from './workspaces.mjs';
import {pump} from './worker.mjs';
import system from './routes/system.mjs';
import settingsRoutes from './routes/settings.mjs';
import workspaceRoutes from './routes/workspaces.mjs';
import documentRoutes from './routes/documents.mjs';
import taskRoutes from './routes/tasks.mjs';
import connectionRoutes from './routes/connections.mjs';
import extensionRoutes from './routes/extensions.mjs';
import folderRoutes from './routes/folders.mjs';
import {chooseDefaultModel} from './routes/common.mjs';

await host.loadRuntime();
chooseDefaultModel();

// Tries the preferred port, then the next ones, so another program on 4317 doesn't stop Rumi from starting.
export async function start({port = Number(process.env.RUMI_PORT) || DEFAULT_PORT, tries = process.env.RUMI_PORT ? 1 : 20} = {}) {
  for (let p = port; p < port + tries; p++) {
    const server = await listen(p).catch(e => (e.code === 'EADDRINUSE' ? null : Promise.reject(e)));
    if (server) return {server, port: p};
  }
  throw Error(`Ports ${port}–${port + tries - 1} are all in use. Set RUMI_PORT to a free port.`);
}

function listen(port) {
  const app = express();
  app.disable('x-powered-by');
  app.use(guard(port));
  app.use(express.json({limit: '25mb'}));
  for (const routes of [system, settingsRoutes, workspaceRoutes, documentRoutes, taskRoutes, connectionRoutes, extensionRoutes, folderRoutes])
    app.use('/api', routes);
  app.use('/api', (q, r) => r.status(404).json({error: `No such API: ${q.method} ${q.path}`}));
  const dist = path.join(appDir, 'dist');
  app.use(
    express.static(dist, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, file) => file.includes(`${path.sep}assets${path.sep}`) && res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
    }),
  );
  // The page itself: never cached, so an update shows after a reload.
  app.get(/^\/(?!api\/).*/, (q, r) => {
    const index = path.join(dist, 'index.html');
    if (!fs.existsSync(index)) return r.status(503).send("Rumi's interface is not built yet. Run: npm run build");
    r.set('Cache-Control', 'no-store').sendFile(index);
  });
  app.use((err, q, r, next) => {
    console.error(err.stack || err.message);
    r.status(err.status || 500).json({error: err.message});
  });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

export function shutdown(server) {
  for (const ws of workspaces.values()) ws.persist.flush();
  server?.close();
  setTimeout(() => process.exit(0), 100).unref();
}

const {server, port} = await start();
writeServerFile(port);
console.log(`Rumi ${version} on http://127.0.0.1:${port}  (data: ${host.root}, sign-ins: ${host.connections.mode === 'pi' ? 'shared with Pi' : "Rumi's own"})`);
pump();
system.onShutdown = () => shutdown(server);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(server));
