#!/usr/bin/env node
// `rumi` — open Rumi in your browser, in the current folder, and manage the background server.
// Run `rumi --help` for the commands.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {appDir, dataDir, configFile, logFile, readJson, serverFile, version, DEFAULT_PORT} from '../server/paths.mjs';

const HELP = `rumi ${version} — a quiet place to write, with agents working beside your words.

Usage
  rumi [folder]            Open Rumi on a folder (default: this one, unless it is your home folder)
  rumi --no-folder         Open the Global workspace
  rumi delegate "<task>"   Hand a task to a worker from the terminal (see below)
  rumi status              Is Rumi running, on which port, with which models
  rumi stop                Stop the background server
  rumi logs [-f] [-n 50]   Show (or follow) the server log
  rumi doctor              Check that everything Rumi needs is in place
  rumi setup               Check your setup, connect local models, open the sign-in screen
  rumi update              Update Rumi the way it was installed
  rumi config [path|get <key>|set <key> <value>]
  rumi link                Print a link that unlocks Rumi in another browser

Options
  --port <n>     Port to use (default ${DEFAULT_PORT}, or the next free one)
  --no-open      Start or find the server without opening the browser
  -v, --version  Print the version
  -h, --help     This help

Delegate
  rumi delegate "Find three studies on spaced repetition" --kind research
  cat notes.md | rumi delegate "Turn this into a plan" --stdin --kind think --wait
  Options: --kind <research|write|think|build|…>  --model <provider/model>  --doc <title or id>
           --file <path> | --stdin (the passage)  --folder <path> | --global  --wait (print the answer)

Data: ${dataDir}
Docs: https://github.com/muzaffermahi/rumi#readme`;

// node:sqlite is still marked experimental; that warning means nothing to someone using Rumi.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w?.message ?? w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = (...a) => console.log(...a);
const die = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      help: {type: 'boolean', short: 'h'},
      version: {type: 'boolean', short: 'v'},
      'no-folder': {type: 'boolean'},
      'no-open': {type: 'boolean'},
      port: {type: 'string'},
      follow: {type: 'boolean', short: 'f'},
      lines: {type: 'string', short: 'n'},
      kind: {type: 'string'},
      model: {type: 'string'},
      doc: {type: 'string'},
      file: {type: 'string'},
      stdin: {type: 'boolean'},
      folder: {type: 'string'},
      global: {type: 'boolean'},
      wait: {type: 'boolean'},
      json: {type: 'boolean'},
    },
  });
} catch (e) {
  die(`${e.message}\nRun rumi --help for usage.`);
}
const {values: opt, positionals: pos} = args;
const COMMANDS = new Set(['stop', 'status', 'logs', 'doctor', 'setup', 'update', 'config', 'link', 'delegate', 'open']);
const command = COMMANDS.has(pos[0]) ? pos[0] : null;

// --- finding and starting the server ---
function serverInfo() {
  const s = readJson(serverFile, null);
  return s?.port ? s : null;
}
async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {signal: AbortSignal.timeout(1500)});
    return r.ok && (await r.json()).rumi === true;
  } catch {
    return false;
  }
}
async function running() {
  const s = serverInfo();
  return s && (await health(s.port)) ? s : null;
}
async function api(s, url, {method = 'GET', body} = {}) {
  const r = await fetch(`http://127.0.0.1:${s.port}/api${url}`, {
    method,
    headers: {Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', 'X-Rumi-CLI': '1'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(data.error || data.message || `HTTP ${r.status}`);
  return data;
}

// A Rumi from before 0.5 (no server.json, no version in its health check) may still be running on the port,
// serving the new interface from the old server. It is stopped so the new one can start in its place.
async function replaceOlder() {
  const port = Number(opt.port || process.env.RUMI_PORT) || DEFAULT_PORT;
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/api/health`, {signal: AbortSignal.timeout(1500)}).then(
    r => (r.ok ? r.json() : null),
    () => null,
  );
  const older =
    health?.rumi === true
      ? !health.version
      : await fetch(`${base}/api/workspaces`, {signal: AbortSignal.timeout(1500)}).then(
          r => r.ok,
          () => false,
        );
  if (!older) return;
  say('Stopping an older Rumi that is still running…');
  await fetch(`${base}/api/shutdown`, {method: 'POST', headers: {'X-Rumi-CLI': '1'}}).catch(() => {});
  for (
    let i = 0;
    i < 25 &&
    (await fetch(`${base}/api/health`, {signal: AbortSignal.timeout(500)}).then(
      () => true,
      () => false,
    ));
    i++
  )
    await sleep(200);
}

async function ensureServer() {
  const found = await running();
  if (found) return found;
  if (!fs.existsSync(path.join(appDir, 'dist', 'index.html'))) die(`Rumi's interface is not built yet. Run: npm run build  (in ${appDir})`);
  await replaceOlder();
  fs.mkdirSync(dataDir, {recursive: true});
  const log = fs.openSync(logFile, 'a');
  // The server finds npm (for Pi packages) next to this Node, which matters for the packaged version.
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH'; // "Path" on Windows
  const env = {...process.env, [key]: path.dirname(process.execPath) + path.delimiter + (process.env[key] || '')};
  if (opt.port) env.RUMI_PORT = opt.port;
  const before = serverInfo()?.started;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(appDir, 'server', 'app.mjs')], {
    cwd: appDir,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
    env,
  });
  child.unref();
  process.stdout.write('Starting Rumi');
  // Usually a second or two. The first start after installing can take much longer while antivirus checks the new files.
  for (let i = 0; i < 225; i++) {
    await sleep(400);
    if (i === 25) process.stdout.write(' (the first start after installing can take a minute)');
    if (i % 3 === 2) process.stdout.write('.');
    const s = serverInfo();
    if (s && s.started !== before && s.pid === child.pid && (await health(s.port))) {
      process.stdout.write('\n');
      return s;
    }
  }
  process.stdout.write('\n');
  die(`Rumi did not start. The end of its log:\n\n${tail(logFile, 15)}\n\nRun rumi doctor for a full check.`);
}

function openBrowser(url) {
  const [cmd, a] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, a, {stdio: 'ignore', detached: true, windowsHide: true})
    .on('error', () => say(`Open ${url} in your browser.`))
    .unref();
}
const unlockUrl = (s, query = '') => `http://127.0.0.1:${s.port}/?token=${encodeURIComponent(s.token)}${query}`;

function tail(file, n) {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n).join('\n');
  } catch {
    return '(no log yet)';
  }
}

// The packaged Windows version (Rumi.cmd next to app/) puts itself in the Start menu the first time it runs.
function addToStartMenu() {
  const cmd = path.join(appDir, '..', 'Rumi.cmd');
  const link = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Rumi.lnk');
  if (process.platform !== 'win32' || process.env.RUMI_NO_SHORTCUT || !process.env.APPDATA || !fs.existsSync(cmd) || fs.existsSync(link)) return;
  const q = s => `'${s.replace(/'/g, "''")}'`;
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(link)});$s.TargetPath=${q(cmd)};$s.WorkingDirectory=${q(path.dirname(cmd))};$s.WindowStyle=7;$s.Description='Rumi';$s.Save()`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // A missing shortcut is not worth failing over.
  spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', ps], {stdio: 'ignore', windowsHide: true, detached: true})
    .on('error', () => {})
    .unref();
}

// --- commands ---
async function open(target) {
  const folder = opt['no-folder'] ? null : path.resolve(target || opt.folder || process.cwd());
  if (folder && !fs.statSync(folder, {throwIfNoEntry: false})?.isDirectory()) die(`Not a folder: ${folder}`);
  const useFolder = folder && (target || folder.toLowerCase() !== os.homedir().toLowerCase());
  const s = await ensureServer();
  const url = unlockUrl(s, useFolder ? `&folder=${encodeURIComponent(folder)}` : '');
  if (!opt['no-open']) openBrowser(url);
  say(useFolder ? `Rumi is open in ${path.basename(folder)}  (http://127.0.0.1:${s.port})` : `Rumi is open  (http://127.0.0.1:${s.port})`);
  addToStartMenu();
}

async function stop() {
  const s = await running();
  if (!s) return say('Rumi is not running.');
  await api(s, '/shutdown', {method: 'POST'}).catch(() => {});
  for (let i = 0; i < 20 && (await health(s.port)); i++) await sleep(200);
  say('Rumi stopped.');
}

async function status() {
  const s = await running();
  if (!s) {
    say(`Rumi ${version} is not running.`);
    return;
  }
  const setup = await api(s, '/setup').catch(() => null);
  const about = await api(s, '/about').catch(() => null);
  if (opt.json) return say(JSON.stringify({running: true, port: s.port, pid: s.pid, version: s.version, setup, about}, null, 2));
  say(`Rumi ${s.version} is running on http://127.0.0.1:${s.port} (pid ${s.pid}, since ${new Date(s.started).toLocaleString()})`);
  say(`Data:    ${dataDir}`);
  if (setup) {
    say(
      `Models:  ${setup.models.length} connected${setup.defaultModel ? `, default ${setup.defaultModel}` : ''}${setup.ready ? '' : '  (not ready: run rumi setup)'}`,
    );
    say(`Sign-ins: ${setup.mode === 'pi' ? 'shared with Pi' : "Rumi's own"}`);
  }
  if (about?.update?.available) say(`Update:  ${about.update.latest} is available. Run rumi update.`);
}

async function logs() {
  const n = Number(opt.lines) || 50;
  say(tail(logFile, n));
  if (!opt.follow) return;
  let size = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  fs.watchFile(logFile, {interval: 500}, cur => {
    if (cur.size < size) size = 0;
    if (cur.size === size) return;
    const fd = fs.openSync(logFile, 'r');
    const buf = Buffer.alloc(cur.size - size);
    fs.readSync(fd, buf, 0, buf.length, size);
    fs.closeSync(fd);
    process.stdout.write(buf.toString('utf8'));
    size = cur.size;
  });
}

async function doctor() {
  const {staticChecks, environment} = await import('../server/doctor.mjs');
  const env = environment();
  say(`Rumi ${env.rumi} · Node ${env.node} · ${env.platform}\nData: ${env.data}\nApp:  ${env.app}\n`);
  const checks = await staticChecks();
  const s = await running();
  if (s) {
    const about = await api(s, '/setup').catch(e => ({error: e.message}));
    checks.push(
      about.error
        ? {name: 'Models', ok: false, detail: about.error, fix: 'See rumi logs.'}
        : about.ready
          ? {name: 'Models', ok: true, detail: `${about.models.length} connected, default ${about.defaultModel}`}
          : {name: 'Models', ok: false, detail: 'no model connected and chosen', fix: 'Run rumi setup, or connect one in Settings → Models.'},
    );
    process.stdout.write('Checking search engines…');
    const search = await api(s, '/search/check').catch(() => ({engines: []}));
    process.stdout.write('\r                          \r');
    for (const e of search.engines)
      checks.push(
        e.ok
          ? {name: `Search: ${e.name}`, ok: true, detail: `${e.results} results in ${e.ms} ms`}
          : {
              name: `Search: ${e.name}`,
              ok: false,
              warn: true,
              detail: e.error,
              fix:
                e.name === 'bing' ? 'Only a fallback.' : 'Searches still use the other engines. Add a keyed engine in Settings → Search if this keeps failing.',
            },
      );
  }
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? '✓' : c.warn ? '!' : '✗';
    if (!c.ok && !c.warn) failed++;
    say(`${mark} ${c.name.padEnd(18)} ${c.detail}${c.fix ? `\n  ${' '.repeat(18)} → ${c.fix}` : ''}`);
  }
  say(`\nLast lines of ${logFile}:\n${tail(logFile, 20)}`);
  if (failed) process.exitCode = 1;
}

async function setup() {
  const s = await ensureServer();
  const st = await api(s, '/setup');
  say(`Models connected: ${st.models.length}${st.defaultModel ? ` (default ${st.defaultModel})` : ''}`);
  for (const l of st.local.filter(l => l.running && !l.connected && l.models.length)) {
    await api(s, '/connections/local', {method: 'POST', body: {id: l.id}}).then(
      () => say(`Connected ${l.name} (${l.models.length} models).`),
      e => say(`Could not connect ${l.name}: ${e.message}`),
    );
  }
  const after = await api(s, '/setup');
  if (after.ready) {
    say(`Ready. Default model: ${after.defaultModel}`);
    if (!opt['no-open']) openBrowser(unlockUrl(s));
    return;
  }
  say('No model is connected yet. Opening the sign-in screen: sign in with a subscription, paste an API key, or start LM Studio or Ollama.');
  openBrowser(unlockUrl(s, '&connect=1'));
}

async function update() {
  const {checkForUpdate, installKind} = await import('../server/update.mjs');
  const info = await checkForUpdate().catch(e => die(`Could not check for updates: ${e.message}`));
  if (!info.available) return say(info.latest ? `Rumi ${version} is the latest version.` : `No releases found yet. You have ${version}.`);
  const how = installKind();
  say(`Rumi ${info.latest} is available (you have ${version}).`);
  const s = await running();
  const restart = async () => {
    if (s) {
      await stop();
      say('Run rumi to start the new version.');
    }
  };
  if (how.kind === 'npm') {
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '-g', 'rumi-app@latest'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) die('npm could not update Rumi. Try: npm install -g rumi-app@latest');
    return restart();
  }
  if (how.kind === 'git') {
    for (const [cmd, a] of [
      ['git', ['pull', '--ff-only']],
      ['npm', ['ci']],
      ['npm', ['run', 'build']],
    ]) {
      say(`> ${cmd} ${a.join(' ')}`);
      const r = spawnSync(process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd, a, {
        cwd: appDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      if (r.status !== 0) die(`${cmd} ${a.join(' ')} failed.`);
    }
    return restart();
  }
  say(how.how);
  openBrowser(info.url);
}

async function config() {
  const [, action, key, ...rest] = pos;
  if (!action || action === 'path') return say(configFile);
  const {config: current, validate, updateConfig} = await import('../server/config.mjs');
  if (action === 'get') {
    if (!key) return say(JSON.stringify(current, null, 2));
    const value = key.split('.').reduce((o, k) => o?.[k], current);
    return say(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
  if (action === 'set') {
    if (!key || !rest.length) die('Usage: rumi config set <key> <value>');
    let value = rest.join(' ');
    try {
      value = JSON.parse(value);
    } catch {}
    const [top, sub] = key.split('.');
    const patch = sub ? {[top]: {[sub]: value}} : {[top]: value};
    const error = validate(sub ? {[top]: {...current[top], [sub]: value}} : patch);
    if (error) die(error);
    const s = await running();
    if (s) await api(s, '/settings', {method: 'PUT', body: patch}).catch(e => die(e.message));
    else {
      const e = updateConfig(patch);
      if (e) die(e);
    }
    return say(`${key} = ${JSON.stringify(value)}`);
  }
  die('Usage: rumi config [path|get <key>|set <key> <value>]');
}

async function link() {
  const s = await ensureServer();
  say(unlockUrl(s));
  say('Anyone with this link on this computer can use Rumi. Keep it to yourself.');
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function delegate() {
  const instruction = pos.slice(1).join(' ').trim();
  const passage = opt.file ? fs.readFileSync(opt.file, 'utf8') : opt.stdin ? await readStdin() : '';
  if (!instruction && !passage.trim()) die('Usage: rumi delegate "<what the worker should do>" [--file passage.md | --stdin] [--kind research] [--wait]');
  const s = await ensureServer();
  let wid = 'global';
  if (!opt.global) {
    const folder = path.resolve(opt.folder || process.cwd());
    if (opt.folder || folder.toLowerCase() !== os.homedir().toLowerCase())
      wid = (await api(s, '/workspaces/open', {method: 'POST', body: {path: folder}})).workspace.id;
  }
  const docs = (await api(s, `/w/${wid}/docs`)).filter(d => !d.archived);
  let doc = opt.doc
    ? docs.find(d => d.id === opt.doc || d.title.toLowerCase() === opt.doc.toLowerCase())
    : [...docs].sort((a, b) => b.updated.localeCompare(a.updated))[0];
  if (opt.doc && !doc) die(`No document called "${opt.doc}". Documents here: ${docs.map(d => d.title).join(', ') || 'none'}`);
  doc ||= await api(s, `/w/${wid}/docs`, {method: 'POST', body: {title: 'Inbox'}});
  const t = await api(s, `/w/${wid}/tasks`, {method: 'POST', body: {instruction, selection: passage, kind: opt.kind, model: opt.model, docId: doc.id}});
  say(`Delegated "${t.title}" (${t.kind}, ${t.model}) in ${doc.title}.`);
  if (!opt.wait) return say(`Follow it in Rumi: http://127.0.0.1:${s.port}`);
  process.stdout.write('Working');
  for (;;) {
    await sleep(2000);
    const cur = await api(s, `/tasks/${t.id}/summary`).catch(() => null);
    if (!cur) continue;
    if (cur.status === 'running' || cur.status === 'queued') {
      process.stdout.write('.');
      continue;
    }
    process.stdout.write('\n');
    if (cur.status === 'needs-you' || cur.dialog)
      die(`The worker needs you: ${cur.question?.question || cur.dialog?.title}\nAnswer it in Rumi: http://127.0.0.1:${s.port}`, 2);
    if (cur.status !== 'finished') die(`The task ${cur.status}${cur.error ? `: ${cur.error}` : ''}`);
    say(cur.handback?.answer || cur.suggestion?.text || '(finished without an answer)');
    if (cur.handback?.notes) say(`\n---\n${cur.handback.notes}`);
    return;
  }
}

if (opt.version) say(version);
else if (opt.help) say(HELP);
else if (command === 'stop') await stop();
else if (command === 'status') await status();
else if (command === 'logs') await logs();
else if (command === 'doctor') await doctor();
else if (command === 'setup') await setup();
else if (command === 'update') await update();
else if (command === 'config') await config();
else if (command === 'link') await link();
else if (command === 'delegate') await delegate();
else if (command === 'open') await open(pos[1]);
else await open(pos[0]);
