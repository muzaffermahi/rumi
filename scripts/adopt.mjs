// `npm run adopt`: makes the Rumi you use this checkout's version. Your documents and settings (in ~/.rumi) stay.
// It builds the interface, swaps the new app into your installed Rumi (its dependencies are reused while the
// lockfile is unchanged), and restarts Rumi if it was running; open pages offer to reload. The app it replaced is
// kept: `npm run adopt -- --undo` goes back to it. With no installed Rumi yet, it installs one from this checkout.
// Run it from a terminal, not from a Build task: restarting Rumi would stop the task.
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const dir =
  process.env.RUMI_INSTALL_DIR ||
  (win
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Rumi')
    : path.join(os.homedir(), '.local', 'share', 'rumi-app'));
const node = path.join(dir, 'node', win ? 'node.exe' : path.join('bin', 'node'));
const npmCli = path.join(dir, 'node', ...(win ? ['node_modules'] : ['lib', 'node_modules']), 'npm', 'bin', 'npm-cli.js');
const app = path.join(dir, 'app'),
  next = path.join(dir, 'app.next'),
  previous = path.join(dir, 'app.previous');
const say = s => console.log(s);
const npm = (...a) => spawnSync(`npm ${a.join(' ')}`, {cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell: true});
const installed = (...a) => spawnSync(node, [path.join(app, 'bin', 'rumi.mjs'), ...a], {encoding: 'utf8'});
const readLock = d => {
  try {
    return fs.readFileSync(path.join(d, 'package-lock.json'), 'utf8');
  } catch {
    return null;
  }
};

// Gives an app its production dependencies: moved over from another app with the same lockfile, or installed.
function deps(target, donor) {
  if (fs.existsSync(path.join(target, 'node_modules'))) return;
  if (donor && fs.existsSync(path.join(donor, 'node_modules')) && readLock(donor) === readLock(target))
    return fs.renameSync(path.join(donor, 'node_modules'), path.join(target, 'node_modules'));
  say('Installing dependencies…');
  execFileSync(node, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {cwd: target, stdio: 'inherit'});
}

const isRunning = () => fs.existsSync(app) && /is running/.test(installed('status').stdout || '');
function restart(wasRunning) {
  if (!wasRunning) return say('Start it with: rumi');
  installed('--no-open', '--no-folder');
  say(installed('status').stdout.split('\n')[0]);
  say('Open pages show "Rumi was updated · Reload".');
}

// --- first time: install Rumi from this checkout, like the one-line installer does ---
if (!fs.existsSync(node)) {
  say('No installed Rumi yet: installing one from this checkout.');
  if (npm('run', 'build', '--silent').status || npm('run', 'package', '--silent').status) process.exit(1);
  const built = fs.readdirSync(path.join(root, 'release')).find(n => n.startsWith('Rumi-') && fs.statSync(path.join(root, 'release', n)).isDirectory());
  fs.mkdirSync(path.dirname(dir), {recursive: true});
  fs.rmSync(dir, {recursive: true, force: true});
  fs.cpSync(path.join(root, 'release', built), dir, {recursive: true});
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, {recursive: true});
  if (win) {
    fs.writeFileSync(path.join(bin, 'rumi.cmd'), '@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\app\\bin\\rumi.mjs" %*\r\n');
    const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if ((($p -split ';') -notcontains '${bin}')) { [Environment]::SetEnvironmentVariable('Path', ('${bin};' + $p).TrimEnd(';'), 'User') }`;
    spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', ps]);
    say(`Installed to ${dir}, and ${bin} is on your PATH (open a new terminal).`);
  } else {
    const link = path.join(os.homedir(), '.local', 'bin', 'rumi');
    fs.mkdirSync(path.dirname(link), {recursive: true});
    fs.writeFileSync(link, `#!/bin/sh\nexec "${node}" "${path.join(app, 'bin', 'rumi.mjs')}" "$@"\n`, {mode: 0o755});
    say(`Installed to ${dir}, with the rumi command in ${path.dirname(link)}.`);
  }
  process.exit(0);
}

// --- going back to the app before the last adopt ---
if (process.argv.includes('--undo')) {
  if (!fs.existsSync(previous)) {
    say('There is no earlier version to go back to.');
    process.exit(1);
  }
  const was = isRunning();
  installed('stop');
  deps(previous, app);
  fs.renameSync(app, next);
  fs.renameSync(previous, app);
  fs.renameSync(next, previous);
  say('Back to the version before the last adopt (run npm run adopt again to return).');
  restart(was);
  process.exit(0);
}

// --- adopting this checkout ---
say('Building the interface…');
if (npm('run', 'build', '--silent').status) process.exit(1);
fs.rmSync(next, {recursive: true, force: true});
fs.mkdirSync(next, {recursive: true});
for (const f of ['package.json', 'package-lock.json', 'README.md', 'LICENSE']) fs.copyFileSync(path.join(root, f), path.join(next, f));
for (const d of ['server', 'pi', 'bin', 'dist', 'schema']) fs.cpSync(path.join(root, d), path.join(next, d), {recursive: true});
if (readLock(next) !== readLock(app)) deps(next); // new dependencies: installed while your Rumi still runs

const was = isRunning();
installed('stop');
deps(next, app);
fs.rmSync(previous, {recursive: true, force: true});
fs.renameSync(app, previous);
fs.renameSync(next, app);
let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  if (execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim()) commit += ' + uncommitted changes';
} catch {}
say(`Your Rumi is now this checkout${commit ? ` (${commit})` : ''}. Go back with: npm run adopt -- --undo`);
restart(was);
