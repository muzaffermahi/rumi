#!/usr/bin/env node
// `rumi` — open Rumi in the current folder. Starts the local server in the background if it isn't running,
// then opens the browser with that folder selected for new tasks.
//   rumi            open, using the current folder (unless it is your home folder)
//   rumi <path>     open with another folder
//   rumi --no-folder
//   rumi stop       stop the background server
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same rule as runtime.mjs: a checkout with data/ keeps it; an installed copy uses ~/.rumi.
const dataDir = path.resolve(process.env.RUMI_DATA || (fs.existsSync(path.join(appDir, 'data')) ? path.join(appDir, 'data') : path.join(os.homedir(), '.rumi')));
const port = Number(process.env.RUMI_PORT || 4317);
const base = `http://127.0.0.1:${port}`;
const args = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function running() {
  try { const r = await fetch(`${base}/api/health`, {signal: AbortSignal.timeout(1500)}); return r.ok && (await r.json()).rumi === true; }
  catch { return false; }
}

async function main() {
  if (args.includes('-h') || args.includes('--help')) {
    console.log('Usage: rumi [folder] [--no-folder]\n       rumi stop\n\nOpens Rumi in your browser, with the folder (default: the current one) ready for new tasks.');
    return;
  }

  if (args[0] === 'stop') {
    if (!await running()) { console.log('Rumi is not running.'); return; }
    await fetch(`${base}/api/shutdown`, {method: 'POST', headers: {'X-Rumi-CLI': '1'}}).catch(() => {});
    console.log('Rumi stopped.');
    return;
  }

  const target = args.find(a => !a.startsWith('-'));
  const folder = args.includes('--no-folder') ? null : path.resolve(target || process.cwd());
  if (folder && !fs.statSync(folder, {throwIfNoEntry: false})?.isDirectory()) { console.error(`Not a folder: ${folder}`); process.exitCode = 1; return; }
  const useFolder = folder && (target || folder.toLowerCase() !== os.homedir().toLowerCase());

  if (!await running()) {
    if (!fs.existsSync(path.join(appDir, 'dist', 'index.html'))) { console.error(`Rumi is not built yet. Run: npm run build  (in ${appDir})`); process.exitCode = 1; return; }
    const probe = await fetch(base, {signal: AbortSignal.timeout(1000)}).then(() => true, () => false);
    // An older Rumi (before /api/health) is replaced; anything else on the port is left alone.
    const older = probe && await fetch(`${base}/api/workspaces`, {signal: AbortSignal.timeout(1000)}).then(r => r.ok, () => false);
    if (older) { await fetch(`${base}/api/shutdown`, {method: 'POST', headers: {'X-Rumi-CLI': '1'}}).catch(() => {}); await sleep(800); }
    else if (probe) { console.error(`Port ${port} is used by another program.`); process.exitCode = 1; return; }
    fs.mkdirSync(dataDir, {recursive: true});
    const log = fs.openSync(path.join(dataDir, 'rumi.log'), 'a');
    // The server finds npm (for Pi packages) next to this Node, which matters for the packaged version.
    const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH'; // "Path" on Windows
    const env = {...process.env, [key]: path.dirname(process.execPath) + path.delimiter + (process.env[key] || '')};
    spawn(process.execPath, [path.join(appDir, 'server.mjs')], {cwd: appDir, detached: true, stdio: ['ignore', log, log], windowsHide: true, env}).unref();
    process.stdout.write('Starting Rumi');
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await sleep(500); up = await running(); if (i % 2) process.stdout.write('.'); }
    process.stdout.write('\n');
    if (!up) { console.error(`Rumi did not start. See ${path.join(dataDir, 'rumi.log')}`); process.exitCode = 1; return; }
  }

  const url = useFolder ? `${base}/?folder=${encodeURIComponent(folder)}` : base;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], {stdio: 'ignore', detached: true, windowsHide: true}).unref();
  console.log(useFolder ? `Rumi is open in ${path.basename(folder)}  (${base})` : `Rumi is open  (${base})`);
  addToStartMenu();
}

// The packaged Windows version (Rumi.cmd next to app/) puts itself in the Start menu the first time it runs.
function addToStartMenu() {
  const cmd = path.join(appDir, '..', 'Rumi.cmd');
  const link = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Rumi.lnk');
  if (process.platform !== 'win32' || !process.env.APPDATA || !fs.existsSync(cmd) || fs.existsSync(link)) return;
  const q = s => `'${s.replace(/'/g, "''")}'`;
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(link)});$s.TargetPath=${q(cmd)};$s.WorkingDirectory=${q(path.dirname(cmd))};$s.WindowStyle=7;$s.Description='Rumi';$s.Save()`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {stdio: 'ignore', windowsHide: true, detached: true}).unref();
}

await main();
