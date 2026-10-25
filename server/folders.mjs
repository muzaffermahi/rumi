// Project folders a task can work in: describe them, remember recent ones, open the system folder picker
// (Windows, macOS, and Linux with zenity or kdialog), and list folders for the in-browser folder browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./pick-folder.ps1', import.meta.url));

export function describeFolder(dir) {
  const raw = String(dir || '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^~(?=$|[\\/])/, os.homedir());
  // An empty path would resolve to Rumi's own working directory.
  if (!raw) return {path: '', name: '', exists: false, isRepo: false};
  const full = path.resolve(raw);
  let isDir = false;
  try {
    isDir = fs.statSync(full).isDirectory();
  } catch {}
  return {path: full, name: path.basename(full) || full, exists: isDir, isRepo: isDir && fs.existsSync(path.join(full, '.git'))};
}

export function remember(recent = [], folder, max = 8) {
  return [folder, ...recent.filter(f => f.path.toLowerCase() !== folder.path.toLowerCase())].slice(0, max);
}

const has = cmd => {
  try {
    execFileSync('which', [cmd], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
};
const linuxPicker = process.platform === 'linux' ? (has('zenity') ? 'zenity' : has('kdialog') ? 'kdialog' : null) : null;
export const canPick = process.platform === 'win32' || process.platform === 'darwin' || !!linuxPicker;

function pickerCommand(start) {
  const title = 'Choose a folder for Rumi';
  if (process.platform === 'win32')
    return ['powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Title', title, ...(start ? ['-Start', start] : [])]];
  if (process.platform === 'darwin') {
    const from = start ? ` default location (POSIX file ${JSON.stringify(start)})` : '';
    return ['osascript', ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(title)}${from})`]];
  }
  if (linuxPicker === 'zenity') return ['zenity', ['--file-selection', '--directory', `--title=${title}`, ...(start ? [`--filename=${start}/`] : [])]];
  return ['kdialog', ['--getexistingdirectory', start || os.homedir(), '--title', title]];
}

// Resolves to the chosen path, or null when the user cancels.
export function pickFolder(start) {
  if (!canPick) return Promise.reject(Error('No folder picker on this system (install zenity or kdialog). Browse or paste the folder path instead.'));
  const [cmd, args] = pickerCommand(start);
  return new Promise((resolve, reject) =>
    execFile(cmd, args, {windowsHide: true, timeout: 10 * 60_000}, (err, stdout, stderr) => {
      // Cancelling exits with 1 on macOS, Linux pickers and the Windows script alike.
      if (err && !stdout.trim())
        return err.code === 1 || /User canceled|-128/.test(stderr) ? resolve(null) : reject(Error(stderr.trim().split('\n')[0] || err.message));
      resolve(stdout.trim().replace(/\/$/, '') || null);
    }),
  );
}

// Folders inside a folder, for the browser's own folder picker. Hidden folders are left out.
export function listFolders(dir) {
  const target = describeFolder(dir || os.homedir());
  if (!target.exists) throw Error(`Folder not found: ${target.path}`);
  let entries = [];
  try {
    entries = fs.readdirSync(target.path, {withFileTypes: true});
  } catch (e) {
    throw Error(`Cannot open ${target.path}: ${e.code === 'EPERM' || e.code === 'EACCES' ? 'permission denied' : e.message}`);
  }
  const folders = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['node_modules', '$RECYCLE.BIN', 'System Volume Information'].includes(e.name))
    .map(e => {
      const full = path.join(target.path, e.name);
      return {name: e.name, path: full, isRepo: fs.existsSync(path.join(full, '.git'))};
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));
  const parent = path.dirname(target.path);
  return {...target, parent: parent !== target.path ? parent : null, folders, roots: roots()};
}

function roots() {
  const out = [{name: 'Home', path: os.homedir()}];
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJ') if (fs.existsSync(`${letter}:\\`)) out.push({name: `${letter}:`, path: `${letter}:\\`});
  } else out.push({name: '/', path: '/'});
  return out;
}
