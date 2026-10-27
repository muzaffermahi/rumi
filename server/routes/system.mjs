// The server itself: health, live updates, shutdown, About (version, checks, log) and the update check.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {appDir, version} from '../paths.mjs';
import {config} from '../config.mjs';
import * as host from '../runtime.mjs';
import {kindsFor} from '../../pi/kinds.mjs';
import {presetsFor} from '../presets.mjs';
import {GLOBAL, state, saveState, workspaceById, workspaces} from '../workspaces.mjs';
import {addToSnapshot, broadcast, clients, snapshot} from '../live.mjs';
import {checkForUpdate} from '../update.mjs';
import {environment, logTail, staticChecks} from '../doctor.mjs';
import {checkEngines} from '../search.mjs';
import {hasGit} from '../git.mjs';
import {handle, ready} from './common.mjs';

const router = express.Router();

// Which build of the interface this server serves. An open page compares it after reconnecting, so a Rumi updated
// underneath it (a release, or `npm run adopt`) offers a reload.
let build = '';
try {
  build = createHash('sha1')
    .update(fs.readFileSync(path.join(appDir, 'dist', 'index.html')))
    .digest('hex')
    .slice(0, 12);
} catch {}

// What every page needs besides its tasks: whether a model is ready, this workspace's kinds and saved instructions,
// the version and whether a newer one is out.
addToSnapshot(ws => {
  const {kinds, errors} = kindsFor(ws.folder);
  return {
    ready: ready(),
    version,
    build,
    onboarded: !!state.onboarded,
    update: state.update?.available ? state.update : null,
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, {label: v.label, hint: v.hint, needsFolder: v.needsFolder, source: v.source}])),
    kindErrors: errors,
    presets: presetsFor(ws.folder),
  };
});

router.get('/health', (q, r) => r.json({rumi: true, version}));

router.get('/events', (q, r) => {
  const ws = workspaceById(q.query.w || GLOBAL) || workspaces.get(GLOBAL);
  r.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
  r.flushHeaders();
  const c = {res: r, ws};
  clients.add(c);
  r.write(`data: ${JSON.stringify(snapshot(ws))}\n\n`);
  const timer = setInterval(() => r.write(': heartbeat\n\n'), 15000);
  q.on('close', () => {
    clearInterval(timer);
    clients.delete(c);
  });
});

// `rumi stop`, or Quit in Settings. A custom header can't be sent cross-origin without a preflight, which the origin check refuses.
router.post('/shutdown', (q, r) => {
  if (q.get('X-Rumi-CLI') !== '1' && q.get('X-Rumi-UI') !== '1') return r.sendStatus(403);
  r.json({ok: true});
  router.onShutdown?.();
});

router.get(
  '/about',
  handle(async (q, r) => {
    r.json({
      environment: environment(),
      checks: await staticChecks(),
      log: logTail(40),
      update: state.update || null,
      models: host.knownModels().length,
      git: await hasGit(),
      mode: host.connections.mode,
    });
  }),
);

// The slower live checks: each chosen search engine runs one query.
router.get(
  '/about/search',
  handle(async (q, r) => r.json({engines: await checkEngines(config.search)})),
);

async function updateCheck() {
  state.update = await checkForUpdate();
  saveState();
  broadcast();
  return state.update;
}
router.post(
  '/update/check',
  handle(async (q, r) => r.json(await updateCheck())),
);

// Once a day, when allowed. A failure (offline, rate-limited) is silent and retried the next day.
const DAY = 24 * 3600_000;
function scheduleUpdateCheck() {
  const last = Date.parse(state.update?.checked || 0) || 0;
  setTimeout(
    () => {
      if (config.updateCheck && !process.env.RUMI_NO_UPDATE_CHECK) updateCheck().catch(() => {});
      setInterval(() => config.updateCheck && !process.env.RUMI_NO_UPDATE_CHECK && updateCheck().catch(() => {}), DAY).unref();
    },
    Math.max(30_000, last + DAY - Date.now()),
  ).unref();
}
scheduleUpdateCheck();

export default router;
