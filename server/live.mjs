// Live updates to the browser: every open page follows one workspace and gets batched snapshots over SSE.
import {parseUserPrompt} from './context.mjs';
import {throttle} from './queue.mjs';
import {publicConfig} from './config.mjs';
import {state, wsInfo, workspaceList, allTasks, wsOfTask} from './workspaces.mjs';

export const clients = new Set();
const extras = [];
// Lets other modules add state to every snapshot (whether a model is connected, the kinds of this workspace…).
export const addToSnapshot = fn => {
  extras.push(fn);
};

// The answer a finished, linked task offers beside its passage.
function suggestionOf(t) {
  if (t.suggestion?.state !== 'pending') return null;
  const text = t.handback?.answer || t.result;
  return text ? {text, summary: t.handback?.summary || '', raw: !t.handback, at: t.suggestion.at} : null;
}

export function summary(t) {
  const queued = [];
  if (!t.started) queued.push({kind: 'delegation', text: t.objective, passage: t.source});
  for (const p of t.pending) queued.push(parseUserPrompt(p));
  for (const p of t.steering || []) queued.push(parseUserPrompt(p));
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    status: t.status,
    model: t.model,
    created: t.created,
    files: t.files,
    error: t.error,
    projectDir: t.projectDir,
    docId: t.docId || null,
    documentWide: !t.source,
    passage: t.source || '',
    objective: t.objective,
    suggestion: suggestionOf(t),
    handback: t.handback || null,
    question: t.status === 'needs-you' ? t.question || null : null,
    dialog: t.dialog || null,
    stalled: !!t.stalled,
    notice: t.notice || null,
    version: t.version || 0,
    live: t.liveOpen ? t.live : '',
    activeTool: t.activeTool || null,
    activity: t.status === 'running' ? t.activity || null : null,
    queued,
    pendingContext: !!t.pendingContext,
    started: t.started,
    warnings: t.warnings || [],
    usage: t.usage || null,
    elapsed: t.elapsed || 0,
    finishedAt: t.finishedAt || null,
    archived: !!t.archived,
    group: t.group || t.id,
    changes: t.checkpoints?.length ? {count: t.checkpoints.length, reverted: !!t.reverted} : null,
    worktree: t.worktree || null,
  };
}

export const snapshot = ws => {
  const s = {
    workspace: wsInfo(ws),
    workspaces: workspaceList(),
    tasks: ws.tasks.map(summary),
    settings: {...publicConfig(), lastKind: state.lastKind, recentFolders: state.recentFolders},
    running: allTasks().filter(t => t.status === 'running').length,
  };
  for (const fn of extras) Object.assign(s, fn(ws));
  return s;
};

export const broadcast = throttle(() => {
  const cache = new Map();
  for (const c of clients) {
    if (!cache.has(c.ws)) cache.set(c.ws, `data: ${JSON.stringify(snapshot(c.ws))}\n\n`);
    c.res.write(cache.get(c.ws));
  }
}, 150);

export function touch(t) {
  if (t) {
    t.updated = new Date().toISOString();
    wsOfTask.get(t.id)?.persist();
  }
  broadcast();
}
export const flush = t => wsOfTask.get(t.id)?.persist.flush();
