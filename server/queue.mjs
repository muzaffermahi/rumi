// Decides which queued tasks may start. Tasks are started oldest first, up to `limit` at once.
// A task that holds its project folder (one that changes files there: a Build task without its own worktree) keeps
// other such tasks in that folder waiting, unless sameFolder is allowed. One that can work on a separate copy of
// the folder (canSeparate) starts anyway; the worker gives it its own worktree.
export const projectKey = dir =>
  dir
    ? dir
        .trim()
        .replace(/[\\/]+$/, '')
        .replace(/\\/g, '/')
        .toLowerCase()
    : null;

const holdsByDefault = t => !!t.projectDir && !t.worktree;

export function nextToStart(tasks, limit, {sameFolder = false, holdsFolder = holdsByDefault, canSeparate = () => false} = {}) {
  const running = tasks.filter(t => t.status === 'running');
  const busy = new Set(running.filter(holdsFolder).map(t => projectKey(t.projectDir)));
  let free = Math.max(0, limit - running.length);
  const picked = [];
  const queued = tasks.filter(t => t.status === 'queued').sort((a, b) => (a.queuedAt || a.created).localeCompare(b.queuedAt || b.created));
  for (const t of queued) {
    if (!free) break;
    const key = sameFolder || !holdsFolder(t) ? null : projectKey(t.projectDir);
    if (key && busy.has(key)) {
      if (!canSeparate(t)) continue;
    } else if (key) busy.add(key);
    picked.push(t);
    free--;
  }
  return picked;
}

// Whether a task should work on its own copy of the folder: a holder of a folder another running task holds.
export const folderTaken = (t, tasks, holdsFolder = holdsByDefault) =>
  tasks.some(o => o !== t && o.status === 'running' && holdsFolder(o) && projectKey(o.projectDir) === projectKey(t.projectDir));

// Calls fn at most once per `ms`, always delivering the latest state (trailing call).
export function throttle(fn, ms) {
  let timer = null,
    last = 0;
  const run = () => {
    timer = null;
    last = Date.now();
    fn();
  };
  const call = () => {
    if (timer) return;
    const wait = Math.max(0, last + ms - Date.now());
    timer = setTimeout(run, wait);
  };
  call.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  return call;
}
