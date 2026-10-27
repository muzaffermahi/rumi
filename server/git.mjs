// Making Build tasks safe to leave alone.
// Checkpoints: before and after each Build run, Rumi snapshots the project folder into its own git repository,
// <project>/.rumi/checkpoints.git, whose work tree is the project. It works in any folder, respects the project's
// .gitignore, and never touches your own repository, branch, index or stash. A task's changes are the difference
// between its first and last snapshot, and reverting restores the first one (after snapshotting what was there).
// Worktrees (git repositories only): a Build task works in <project>/.rumi/worktrees/<id> on its own branch.
// With the worktrees setting on, every Build task gets one, branched from your last commit, and you merge or discard
// it when it is done. Otherwise one is made only when a second Build task starts while another is working in the
// folder: it starts from your files as they are, uncommitted changes included, and its changes are applied to your
// folder when you take them, as if it had worked there.
import {execFile, execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_PATCH = 400_000;

function run(args, {cwd, env} = {}) {
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      args,
      {cwd, env: {...process.env, GIT_TERMINAL_PROMPT: '0', ...env}, maxBuffer: 64 * 1024 * 1024, windowsHide: true},
      (err, stdout, stderr) => {
        if (err) reject(Error((stderr || err.message).trim().split('\n').slice(-3).join(' ')));
        else resolve(stdout);
      },
    ),
  );
}

let gitVersion;
export async function hasGit() {
  if (gitVersion === undefined)
    gitVersion = await run(['--version']).then(
      v => v.trim(),
      () => null,
    );
  return !!gitVersion;
}

// --- checkpoints ---
const gitDir = folder => path.join(folder, '.rumi', 'checkpoints.git');
const cp = (folder, args) => run(['--git-dir', gitDir(folder), '--work-tree', folder, ...args], {cwd: folder});

async function ensure(folder) {
  const dir = gitDir(folder);
  if (fs.existsSync(path.join(dir, 'HEAD'))) return;
  fs.mkdirSync(dir, {recursive: true});
  await run(['--git-dir', dir, 'init', '--quiet'], {cwd: folder});
  for (const [k, v] of [
    ['user.name', 'Rumi'],
    ['user.email', 'rumi@localhost'],
    ['core.autocrlf', 'false'],
    ['core.quotepath', 'false'],
    ['gc.auto', '256'],
  ])
    await run(['--git-dir', dir, 'config', k, v]);
  // Rumi's own folder never goes in; dependency folders stay out even where there is no .gitignore.
  fs.writeFileSync(path.join(dir, 'info', 'exclude'), '.rumi/\nnode_modules/\n.venv/\n__pycache__/\n');
}

// Snapshots the folder. Returns the commit id, or null when git is missing.
export async function checkpoint(folder, label) {
  if (!(await hasGit())) return null;
  await ensure(folder);
  await cp(folder, ['add', '-A', '--ignore-errors']);
  const tree = (await cp(folder, ['write-tree'])).trim();
  const commit = (await cp(folder, ['commit-tree', tree, '-m', label || 'Rumi checkpoint'])).trim();
  await cp(folder, ['update-ref', `refs/rumi/${Date.now()}`, commit]); // keeps it from garbage collection
  return commit;
}

// What changed between two checkpoints: the files, a summary line and the patch (cut when very long).
export async function changes(folder, from, to) {
  const names = await cp(folder, ['diff', '--name-status', '--no-renames', from, to]);
  const files = names
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [status, ...rest] = l.split('\t');
      return {status: {A: 'added', M: 'modified', D: 'deleted'}[status[0]] || status, path: rest.join('\t')};
    });
  const stat = (await cp(folder, ['diff', '--shortstat', from, to])).trim();
  let patch = await cp(folder, ['diff', '--no-color', '--no-ext-diff', '--no-renames', from, to]);
  const cut = patch.length > MAX_PATCH;
  if (cut) patch = patch.slice(0, MAX_PATCH);
  return {files, stat, patch, cut};
}

// Puts the folder back as it was at a checkpoint. Snapshots the current state first and returns that commit,
// so the revert can itself be undone. Ignored files (by .gitignore) are left alone.
export async function restoreCheckpoint(folder, commit, label = 'Before reverting') {
  const now = await checkpoint(folder, label);
  await cp(folder, ['read-tree', '-u', '--reset', commit]);
  return now;
}

// --- worktrees ---
const isRepo = folder => fs.existsSync(path.join(folder, '.git'));
export const worktreeDir = (folder, id) => path.join(folder, '.rumi', 'worktrees', id.slice(0, 8));
export const branchOf = id => `rumi/${id.slice(0, 8)}`;

export async function createWorktree(folder, id) {
  if (!(await hasGit())) throw Error('Git is not installed, so Build tasks cannot get their own worktree.');
  if (!isRepo(folder)) throw Error('Worktrees need a git repository. This folder is not one.');
  const dir = worktreeDir(folder, id);
  if (fs.existsSync(dir)) return dir;
  try {
    await run(['rev-parse', '--verify', 'HEAD'], {cwd: folder});
  } catch {
    throw Error('The repository has no commits yet, so there is nothing to branch from.');
  }
  fs.mkdirSync(path.dirname(dir), {recursive: true});
  await run(['worktree', 'add', '-b', branchOf(id), dir, 'HEAD'], {cwd: folder});
  return dir;
}

// Whether a folder can give a task its own worktree: a git repository with at least one commit. Asked by the queue
// on every pass, so the answer is kept for a few seconds.
const branchable = new Map();
export function canBranch(folder) {
  const hit = branchable.get(folder);
  if (hit && Date.now() - hit.at < 10_000) return hit.ok;
  let ok = false;
  if (gitVersion !== null && isRepo(folder))
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {cwd: folder, stdio: 'ignore', windowsHide: true});
      ok = true;
    } catch {}
  branchable.set(folder, {ok, at: Date.now()});
  return ok;
}

// A worktree that starts from the folder as it is now: your uncommitted and untracked files (minus ignored ones)
// are snapshotted into a commit on top of HEAD, using a separate index so yours is untouched. Returns the worktree
// and that commit, its base.
export async function createWorktreeFromFiles(folder, id) {
  if (!canBranch(folder)) throw Error('This folder is not a git repository with commits.');
  const dir = worktreeDir(folder, id);
  fs.mkdirSync(path.dirname(dir), {recursive: true});
  const env = {GIT_INDEX_FILE: path.join(folder, '.rumi', `index-${id.slice(0, 8)}`)};
  try {
    await run(['read-tree', 'HEAD'], {cwd: folder, env});
    await run(['add', '-A'], {cwd: folder, env});
    const tree = (await run(['write-tree'], {cwd: folder, env})).trim();
    const base = (
      await run(['-c', 'user.name=Rumi', '-c', 'user.email=rumi@localhost', 'commit-tree', tree, '-p', 'HEAD', '-m', 'Rumi: your files'], {cwd: folder})
    ).trim();
    await run(['worktree', 'add', '-b', branchOf(id), dir, base], {cwd: folder});
    return {dir, base};
  } finally {
    fs.rmSync(env.GIT_INDEX_FILE, {force: true});
  }
}

// The worktree's changes against the commit it started from, including files not yet committed.
export async function worktreeChanges(folder, id, from) {
  const dir = worktreeDir(folder, id);
  await run(['add', '-A'], {cwd: dir});
  const base = from || (await run(['merge-base', 'HEAD', branchOf(id)], {cwd: folder}).catch(() => 'HEAD')).trim() || 'HEAD';
  const names = await run(['diff', '--cached', '--name-status', '--no-renames', base], {cwd: dir});
  const files = names
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [status, ...rest] = l.split('\t');
      return {status: {A: 'added', M: 'modified', D: 'deleted'}[status[0]] || status, path: rest.join('\t')};
    });
  const stat = (await run(['diff', '--cached', '--shortstat', base], {cwd: dir})).trim();
  let patch = await run(['diff', '--cached', '--no-color', '--no-ext-diff', '--no-renames', base], {cwd: dir});
  const cut = patch.length > MAX_PATCH;
  if (cut) patch = patch.slice(0, MAX_PATCH);
  return {files, stat, patch, cut, branch: branchOf(id), dir};
}

// Commits the worktree's changes on its branch and merges that branch into whatever is checked out in the project.
export async function mergeWorktree(folder, id, title) {
  const dir = worktreeDir(folder, id);
  await run(['add', '-A'], {cwd: dir});
  const dirty = (await run(['status', '--porcelain'], {cwd: dir})).trim();
  if (dirty) await run(['-c', 'user.name=Rumi', '-c', 'user.email=rumi@localhost', 'commit', '--quiet', '-m', `Rumi: ${title}`.slice(0, 200)], {cwd: dir});
  // The merge commit is yours, so it uses your git identity; Rumi's stands in only when git has none set up.
  const named = await run(['config', 'user.email'], {cwd: folder}).then(
    v => !!v.trim(),
    () => false,
  );
  const identity = named ? [] : ['-c', 'user.name=Rumi', '-c', 'user.email=rumi@localhost'];
  try {
    await run([...identity, 'merge', '--no-ff', '--no-edit', branchOf(id)], {cwd: folder});
  } catch (e) {
    await run(['merge', '--abort'], {cwd: folder}).catch(() => {});
    throw Error(`Could not merge ${branchOf(id)}: ${e.message} The branch is kept; merge it yourself or discard it.`);
  }
  await discardWorktree(folder, id, {keepBranch: false});
}

// For a worktree made from your files: applies its changes since `base` to your folder, uncommitted, as if the task
// had worked there. Your index is never touched. A file you did not change meanwhile simply takes the task's version;
// one you did is merged line by line (git merge-file), and where you both changed the same lines the conflict is
// marked in the file. Then the copy is removed, unless something conflicted: its branch is kept to compare with.
export async function applyWorktree(folder, id, base) {
  const dir = worktreeDir(folder, id);
  await run(['add', '-A'], {cwd: dir});
  const dirty = (await run(['status', '--porcelain'], {cwd: dir})).trim();
  if (dirty) await run(['-c', 'user.name=Rumi', '-c', 'user.email=rumi@localhost', 'commit', '--quiet', '-m', 'Rumi: the task’s changes'], {cwd: dir});
  const blob = (rev, p) => {
    try {
      return execFileSync('git', ['show', `${rev}:${p}`], {cwd: folder, maxBuffer: 256 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
    } catch {
      return null; // not in that version
    }
  };
  const names = (await run(['diff', '--name-only', '--no-renames', '-z', base, branchOf(id)], {cwd: folder})).split('\0').filter(Boolean);
  const conflicts = [];
  const tmp = fs.mkdtempSync(path.join(folder, '.rumi', 'apply-'));
  try {
    for (const p of names) {
      const file = path.join(folder, p);
      const before = blob(base, p);
      const theirs = blob(branchOf(id), p);
      const ours = fs.existsSync(file) ? fs.readFileSync(file) : null;
      // Git may have checked your file out with Windows line endings; compare and merge in the stored form.
      const crlf = ours && !ours.includes(0) && ours.includes('\r\n') && !before?.includes('\r\n');
      const norm = b => (b && crlf ? Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n')) : b);
      const out = b => (crlf && !b.includes(0) ? Buffer.from(b.toString('utf8').replace(/\r?\n/g, '\r\n')) : b);
      const mine = norm(ours);
      if (mine === null ? before === null : before && mine.equals(before)) {
        // You left this file alone: it becomes the task's version (or goes, if the task deleted it).
        if (theirs) {
          fs.mkdirSync(path.dirname(file), {recursive: true});
          fs.writeFileSync(file, out(theirs));
        } else fs.rmSync(file, {force: true});
        continue;
      }
      if (theirs && mine && theirs.equals(mine)) continue; // you made the same change
      if (!theirs || !mine || theirs.includes(0) || mine.includes(0)) {
        conflicts.push(p); // a deletion against an edit, or a binary file: yours stays
        continue;
      }
      const write = (n, b) => (fs.writeFileSync(path.join(tmp, n), b || ''), path.join(tmp, n));
      const r = spawnSync(
        'git',
        ['merge-file', '-p', '-L', 'yours', '-L', 'before', '-L', 'the task', write('ours', mine), write('base', before), write('theirs', theirs)],
        {cwd: folder, maxBuffer: 256 * 1024 * 1024, windowsHide: true},
      );
      if (r.status < 0 || r.error || !r.stdout) {
        conflicts.push(p);
        continue;
      }
      fs.writeFileSync(file, out(r.stdout));
      if (r.status > 0) conflicts.push(p);
    }
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
  if (conflicts.length) {
    // Applied as far as it goes: the copy is removed (so it is not applied twice) and the branch kept to compare.
    await discardWorktree(folder, id, {keepBranch: true});
    throw Object.assign(
      Error(
        `Its changes overlap with changes made in your folder since it started, in ${conflicts.join(', ')}. The rest is applied, and the overlaps are marked in the files (or yours kept, for binary and deleted files). Its branch ${branchOf(id)} is kept so you can compare.`,
      ),
      {applied: true},
    );
  }
  await discardWorktree(folder, id, {keepBranch: false});
}

export async function discardWorktree(folder, id, {keepBranch = false} = {}) {
  const dir = worktreeDir(folder, id);
  if (fs.existsSync(dir)) await run(['worktree', 'remove', '--force', dir], {cwd: folder});
  await run(['worktree', 'prune'], {cwd: folder}).catch(() => {});
  if (!keepBranch) await run(['branch', '-D', branchOf(id)], {cwd: folder}).catch(() => {});
}
