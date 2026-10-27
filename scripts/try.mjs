// `npm run try`: runs this checkout's Rumi beside yours, to try a change before you adopt it (npm run adopt).
// It builds the interface, then starts on port 4400 with its own data in .rumi-try/, so your documents are safe.
// The first time, your settings and model connections are copied in, so the same models work there.
//   npm run try                 build and (re)start it, opening the Global workspace
//   npm run try -- <folder>     open it on a folder (not one your own Rumi has tasks running in)
//   npm run try -- --fresh      start over with empty data
//   npm run try -- --stop       stop it
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const data = path.join(root, '.rumi-try');
const yours = process.env.RUMI_REAL_DATA || path.join(os.homedir(), '.rumi');
const env = {...process.env, RUMI_DATA: data, RUMI_PORT: process.env.RUMI_TRY_PORT || '4400', RUMI_NO_UPDATE_CHECK: '1', RUMI_NO_SHORTCUT: '1'};
const rumi = (...a) => spawnSync(process.execPath, [path.join(root, 'bin', 'rumi.mjs'), ...a], {env, stdio: 'inherit'});

// Whatever ran before is stopped, so the new code is what runs.
if (fs.existsSync(path.join(data, 'server.json'))) spawnSync(process.execPath, [path.join(root, 'bin', 'rumi.mjs'), 'stop'], {env, stdio: 'ignore'});
if (args.includes('--stop')) process.exit(0);
if (args.includes('--fresh')) fs.rmSync(data, {recursive: true, force: true});

if (!fs.existsSync(data)) {
  fs.mkdirSync(path.join(data, 'pi'), {recursive: true});
  for (const f of ['config.json', path.join('pi', 'connections.json'), path.join('pi', 'auth.json'), path.join('pi', 'models.json')])
    if (fs.existsSync(path.join(yours, f))) fs.copyFileSync(path.join(yours, f), path.join(data, f));
}

console.log('Building the interface…');
const build = spawnSync('npm run build --silent', {cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell: true});
if (build.status) process.exit(build.status);

const folder = args.find(a => !a.startsWith('--'));
const r = rumi(...(folder ? [path.resolve(folder)] : ['--no-folder']));
if (!r.status) console.log('\nThis is the version in this checkout, with test data. Yours is untouched. Make it yours with: npm run adopt');
process.exit(r.status ?? 1);
