// Project folders a task can work in: describe them, remember recent ones, and open the system folder picker.
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./pick-folder.ps1', import.meta.url));

export function describeFolder(dir) {
  const raw = String(dir || '').trim().replace(/^"(.*)"$/, '$1');
  // An empty path would resolve to Rumi's own working directory.
  if (!raw) return {path: '', name: '', exists: false, isRepo: false};
  const full = path.resolve(raw);
  let isDir = false;
  try { isDir = fs.statSync(full).isDirectory(); } catch {}
  return {path: full, name: path.basename(full) || full, exists: isDir, isRepo: isDir && fs.existsSync(path.join(full, '.git'))};
}

export function remember(recent = [], folder, max = 6) {
  return [folder, ...recent.filter(f => f.path.toLowerCase() !== folder.path.toLowerCase())].slice(0, max);
}

export const canPick = process.platform === 'win32';

// Resolves to the chosen path, or null when the user cancels.
export function pickFolder(start) {
  if (!canPick) return Promise.reject(Error('The folder picker is only available on Windows. Paste the folder path instead.'));
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Title', 'Choose a folder for this task'];
  if (start) args.push('-Start', start);
  return new Promise((resolve, reject) => execFile('powershell.exe', args, {windowsHide: true, timeout: 10 * 60_000}, (err, stdout, stderr) => {
    if (err && !stdout) return reject(Error(stderr.trim().split('\n')[0] || err.message));
    resolve(stdout.trim() || null);
  }));
}
