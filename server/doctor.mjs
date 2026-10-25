// `rumi doctor`: what Rumi needs, checked one by one, with a fix for each problem. Runs without the server (the CLI)
// and inside it (Settings → About adds the live parts: models and search engines).
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {appDir, dataDir, configFile, logFile, piDir, readJson, serverFile, version, DEFAULT_PORT} from './paths.mjs';

const ok = (name, detail) => ({name, ok: true, detail});
const bad = (name, detail, fix, warn = false) => ({name, ok: false, warn, detail, fix});

const portFree = port =>
  new Promise(resolve => {
    const s = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });

export async function staticChecks() {
  const out = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  out.push(
    major > 22 || (major === 22 && minor >= 19)
      ? ok('Node.js', process.versions.node)
      : bad('Node.js', process.versions.node, 'Install Node 22.19 or newer from https://nodejs.org'),
  );
  try {
    const {DatabaseSync} = await import('node:sqlite');
    new DatabaseSync(':memory:').close();
    out.push(ok('SQLite', 'built into Node'));
  } catch (e) {
    out.push(bad('SQLite', e.message, 'Use Node 22.19 or newer, which includes node:sqlite.'));
  }
  try {
    fs.mkdirSync(dataDir, {recursive: true});
    const probe = path.join(dataDir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    out.push(ok('Data folder', dataDir));
  } catch (e) {
    out.push(bad('Data folder', `${dataDir}: ${e.message}`, 'Make it writable, or set RUMI_DATA to another folder.'));
  }
  out.push(fs.existsSync(path.join(appDir, 'dist', 'index.html')) ? ok('Interface', 'built') : bad('Interface', 'not built', `Run npm run build in ${appDir}`));
  if (fs.existsSync(configFile)) {
    try {
      JSON.parse(fs.readFileSync(configFile, 'utf8'));
      out.push(ok('Settings file', configFile));
    } catch (e) {
      out.push(bad('Settings file', `${configFile}: ${e.message}`, 'Fix the JSON, or delete the file to start from the defaults.'));
    }
  } else out.push(ok('Settings file', 'defaults (no config.json yet)'));
  const server = readJson(serverFile, null);
  const port = server?.port || Number(process.env.RUMI_PORT) || DEFAULT_PORT;
  let running = false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {signal: AbortSignal.timeout(1500)});
    running = r.ok && (await r.json()).rumi === true;
  } catch {}
  if (running) out.push(ok('Server', `running on port ${port}`));
  else
    out.push(
      (await portFree(port))
        ? ok('Server', `not running; port ${port} is free`)
        : bad('Server', `port ${port} is used by another program`, 'Rumi will use the next free port, or set RUMI_PORT.', true),
    );
  const git = await new Promise(resolve =>
    import('node:child_process').then(({execFile}) => execFile('git', ['--version'], (e, out) => resolve(e ? null : out.trim()))),
  );
  out.push(git ? ok('Git', git) : bad('Git', 'not found', 'Install git to get checkpoints and one-click revert for Build tasks.', true));
  const auth = path.join(piDir, 'auth.json');
  if (process.platform !== 'win32' && fs.existsSync(auth) && fs.statSync(auth).mode & 0o077)
    out.push(bad('Sign-in file', `${auth} is readable by other users`, `chmod 600 ${auth}`));
  return out;
}

export function logTail(lines = 20) {
  try {
    return fs.readFileSync(logFile, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export function environment() {
  return {rumi: version, node: process.versions.node, platform: `${os.platform()} ${os.release()} ${os.arch()}`, data: dataDir, app: appDir};
}
