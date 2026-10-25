// Live updates to the browser: every open page follows one workspace and gets batched snapshots over SSE.
import {parseUserPrompt} from './context.mjs';
import {throttle} from './queue.mjs';
import {settings, wsInfo, workspaceList, allTasks, wsOfTask} from './workspaces.mjs';

export const clients = new Set();
let extra = () => ({});
// Lets other modules add app-wide state to every snapshot (e.g. whether a model is connected).
export const addToSnapshot = fn => { extra = fn; };

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
    id: t.id, title: t.title, kind: t.kind, status: t.status, model: t.model, created: t.created, files: t.files, error: t.error,
    projectDir: t.projectDir, documentWide: !t.source, passage: t.source || '',
    suggestion: suggestionOf(t), handback: t.handback || null,
    question: t.status === 'needs-you' ? t.question || null : null, dialog: t.dialog || null, stalled: !!t.stalled, notice: t.notice || null,
    version: t.version || 0, live: t.liveOpen ? t.live : '', activeTool: t.activeTool || null, activity: t.status === 'running' ? t.activity || null : null,
    queued, pendingContext: !!t.pendingContext, started: t.started, warnings: t.warnings || [],
  };
}

export const snapshot = ws => ({workspace: wsInfo(ws), workspaces: workspaceList(), tasks: ws.tasks.map(summary), settings, running: allTasks().filter(t => t.status === 'running').length, ...extra()});

export const broadcast = throttle(() => {
  const cache = new Map();
  for (const c of clients) {
    if (!cache.has(c.ws)) cache.set(c.ws, `data: ${JSON.stringify(snapshot(c.ws))}\n\n`);
    c.res.write(cache.get(c.ws));
  }
}, 150);

export function touch(t) {
  if (t) { t.updated = new Date().toISOString(); wsOfTask.get(t.id)?.persist(); }
  broadcast();
}
export const flush = t => wsOfTask.get(t.id)?.persist.flush();
