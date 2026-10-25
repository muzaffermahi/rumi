// Builds a ready-to-run Rumi for this computer's platform: Node and npm, Rumi, and its production dependencies,
// in one folder and one zip. Whoever downloads it unzips it and double-clicks Rumi; no terminal, no installs.
// Run `npm run build` first. CI runs this once per platform (see .github/workflows/release.yml).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = {win32: 'windows', darwin: 'mac', linux: 'linux'}[process.platform] || process.platform;
const name = `Rumi-${platform}-${process.arch}`;
const release = path.join(root, 'release'),
  out = path.join(release, name);
const win = process.platform === 'win32';

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('Build the interface first: npm run build');
  process.exit(1);
}
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(path.join(out, 'app'), {recursive: true});
const copy = (from, to) => fs.cpSync(from, to, {recursive: true});

// 1. Rumi itself.
for (const f of ['package.json', 'package-lock.json', 'README.md', 'LICENSE']) copy(path.join(root, f), path.join(out, 'app', f));
for (const d of ['server', 'pi', 'bin', 'dist', 'schema']) copy(path.join(root, d), path.join(out, 'app', d));

// 2. Node and npm, taken from the Node running this script. npm is there so Rumi can add Pi packages later.
const nodeDir = path.join(out, 'node');
const prefix = win ? path.dirname(process.execPath) : path.resolve(path.dirname(process.execPath), '..');
const npmFrom = win ? path.join(prefix, 'node_modules', 'npm') : path.join(prefix, 'lib', 'node_modules', 'npm');
if (!fs.existsSync(npmFrom)) {
  console.error(`npm not found next to Node (${npmFrom}). Use an official Node install.`);
  process.exit(1);
}
let node, npmCli;
if (win) {
  fs.mkdirSync(nodeDir, {recursive: true});
  node = path.join(nodeDir, 'node.exe');
  fs.copyFileSync(process.execPath, node);
  copy(npmFrom, path.join(nodeDir, 'node_modules', 'npm'));
  for (const f of ['npm.cmd', 'npx.cmd', 'npm', 'npx']) if (fs.existsSync(path.join(prefix, f))) fs.copyFileSync(path.join(prefix, f), path.join(nodeDir, f));
  npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
} else {
  fs.mkdirSync(path.join(nodeDir, 'bin'), {recursive: true});
  node = path.join(nodeDir, 'bin', 'node');
  fs.copyFileSync(process.execPath, node);
  fs.chmodSync(node, 0o755);
  copy(npmFrom, path.join(nodeDir, 'lib', 'node_modules', 'npm'));
  npmCli = path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  for (const [cmd, file] of [
    ['npm', 'npm-cli.js'],
    ['npx', 'npx-cli.js'],
  ]) {
    fs.writeFileSync(path.join(nodeDir, 'bin', cmd), `#!/bin/sh\nexec "$(dirname "$0")/node" "$(dirname "$0")/../lib/node_modules/npm/bin/${file}" "$@"\n`, {
      mode: 0o755,
    });
  }
}

// 3. Production dependencies, installed with that npm.
console.log('Installing dependencies…');
execFileSync(node, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {cwd: path.join(out, 'app'), stdio: 'inherit'});

// 4. The thing to double-click, and a short note.
if (win) {
  fs.writeFileSync(
    path.join(out, 'Rumi.cmd'),
    [
      '@echo off',
      'rem Starts Rumi in the background and opens it in your browser. This window closes by itself.',
      'set "PATH=%~dp0node;%PATH%"',
      '"%~dp0node\\node.exe" "%~dp0app\\bin\\rumi.mjs" --no-folder',
      'if errorlevel 1 pause',
      '',
    ].join('\r\n'),
  );
} else {
  const launcher = path.join(out, platform === 'mac' ? 'Rumi.command' : 'rumi.sh');
  fs.writeFileSync(
    launcher,
    [
      '#!/bin/sh',
      '# Starts Rumi in the background and opens it in your browser.',
      'cd "$(dirname "$0")"',
      'export PATH="$PWD/node/bin:$PATH"',
      '"$PWD/node/bin/node" "$PWD/app/bin/rumi.mjs" --no-folder || { printf "Press Enter to close"; read _; }',
      '',
    ].join('\n'),
    {mode: 0o755},
  );
}
const open = win
  ? 'Double-click Rumi (Rumi.cmd).'
  : platform === 'mac'
    ? 'Double-click Rumi.command. The first time, macOS may ask: right-click it, choose Open, then Open again.'
    : 'Run rumi.sh (double-click, or ./rumi.sh).';
fs.writeFileSync(
  path.join(out, 'Read me.txt'),
  `Rumi — a quiet place to write, with agents working beside your words.

1. ${open}
2. Your browser opens Rumi. Connect a model: sign in with a subscription you have (ChatGPT, Claude, Grok, Copilot…),
   paste an API key, or use LM Studio / Ollama on this computer.
3. Write. Select a passage and press Ctrl+Enter (Cmd+Enter on a Mac) to hand it to an agent.

Rumi keeps your documents and settings in the .rumi folder in your home folder, so you can replace this folder with a
newer version at any time. To stop Rumi: Settings → Quit Rumi.${win ? '\nRumi adds itself to the Start menu the first time it runs.' : ''}
`,
);

// 5. Zip it. Windows 10+ and macOS ship bsdtar, which writes zips (Git's GNU tar, often first on PATH, cannot);
// Linux gets a .tar.gz.
const archive = process.platform === 'linux' ? `${name}.tar.gz` : `${name}.zip`;
fs.rmSync(path.join(release, archive), {force: true});
const tar = win ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : process.platform === 'darwin' ? '/usr/bin/tar' : 'tar';
execFileSync(tar, process.platform === 'linux' ? ['-czf', archive, name] : ['-a', '-c', '-f', archive, name], {cwd: release, stdio: 'inherit'});
const size = fs.statSync(path.join(release, archive)).size;
console.log(`release/${archive}  (${(size / 1e6).toFixed(0)} MB)`);

// A checksum beside the archive: install.sh, install.ps1 and the Homebrew and Scoop manifests check it.
const {createHash} = await import('node:crypto');
const sha = createHash('sha256')
  .update(fs.readFileSync(path.join(release, archive)))
  .digest('hex');
fs.writeFileSync(path.join(release, `${archive}.sha256`), `${sha}  ${archive}\n`);
console.log(`release/${archive}.sha256  ${sha}`);
