// Decides which queued tasks may start. Tasks are started oldest first, up to `limit` at once.
// Tasks working in the same project folder run one at a time unless sameFolder is allowed.
export const projectKey = dir => dir ? dir.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase() : null;

export function nextToStart(tasks, limit, {sameFolder = false} = {}) {
  const running = tasks.filter(t => t.status === 'running');
  const busy = new Set(running.map(t => projectKey(t.projectDir)).filter(Boolean));
  let free = Math.max(0, limit - running.length);
  const picked = [];
  const queued = tasks.filter(t => t.status === 'queued').sort((a, b) => (a.queuedAt || a.created).localeCompare(b.queuedAt || b.created));
  for (const t of queued) {
    if (!free) break;
    const key = sameFolder ? null : projectKey(t.projectDir);
    if (key && busy.has(key)) continue;
    if (key) busy.add(key);
    picked.push(t);
    free--;
  }
  return picked;
}

// Calls fn at most once per `ms`, always delivering the latest state (trailing call).
export function throttle(fn, ms) {
  let timer = null, last = 0;
  const run = () => { timer = null; last = Date.now(); fn(); };
  const call = () => {
    if (timer) return;
    const wait = Math.max(0, last + ms - Date.now());
    timer = setTimeout(run, wait);
  };
  call.flush = () => { if (timer) clearTimeout(timer); run(); };
  return call;
}
