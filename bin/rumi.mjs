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
const port = Number(process.env.RUMI_PORT || 4317);
const base = `http://127.0.0.1:${port}`;
const args = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function running() {
  try { const r = await fetch(`${base}/api/document`, {signal: AbortSignal.timeout(1500)}); return r.ok && (await r.json()).revision !== undefined; }
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
    if (probe) { console.error(`Port ${port} is used by another program.`); process.exitCode = 1; return; }
    fs.mkdirSync(path.join(appDir, 'data'), {recursive: true});
    const log = fs.openSync(path.join(appDir, 'data', 'rumi.log'), 'a');
    spawn(process.execPath, [path.join(appDir, 'server.mjs')], {cwd: appDir, detached: true, stdio: ['ignore', log, log], windowsHide: true}).unref();
    process.stdout.write('Starting Rumi');
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { await sleep(500); up = await running(); if (i % 2) process.stdout.write('.'); }
    process.stdout.write('\n');
    if (!up) { console.error(`Rumi did not start. See ${path.join(appDir, 'data', 'rumi.log')}`); process.exitCode = 1; return; }
  }

  const url = useFolder ? `${base}/?folder=${encodeURIComponent(folder)}` : base;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], {stdio: 'ignore', detached: true, windowsHide: true}).unref();
  console.log(useFolder ? `Rumi is open in ${path.basename(folder)}  (${base})` : `Rumi is open  (${base})`);
}

await main();
