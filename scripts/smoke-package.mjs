// CI: starts the packaged Rumi in release/ with only its bundled Node, checks it answers, and stops it.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const release = path.resolve('release');
const dir = fs
  .readdirSync(release)
  .map(n => path.join(release, n))
  .find(p => fs.statSync(p).isDirectory() && path.basename(p).startsWith('Rumi-'));
if (!dir) throw Error('No packaged build in release/. Run npm run package first.');
const node = process.platform === 'win32' ? path.join(dir, 'node', 'node.exe') : path.join(dir, 'node', 'bin', 'node');
const cli = path.join(dir, 'app', 'bin', 'rumi.mjs');
const env = {
  ...process.env,
  RUMI_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-smoke-')),
  RUMI_PORT: '4499',
  RUMI_NO_UPDATE_CHECK: '1',
  RUMI_NO_SHORTCUT: '1',
  PATH: path.dirname(node),
};
const run = (...args) => execFileSync(node, [cli, ...args], {env, stdio: 'pipe', timeout: 60_000}).toString();
console.log(run('--no-folder', '--no-open'));
const status = run('status');
console.log(status);
if (!status.includes('is running')) throw Error('The packaged Rumi did not start.');
const health = await fetch('http://127.0.0.1:4499/api/health').then(r => r.json());
if (health.rumi !== true) throw Error('Health check failed.');
console.log(run('stop'));
