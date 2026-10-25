// Running tasks: one Pi session per task, a queue with a small number of slots, and the rules that keep a
// worker honest: it hands back with finish (or asks with ask_user), and a run that stops making progress is noticed.
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {makeSession, resolveModel} from './runtime.mjs';
import {kindOf} from '../pi/kinds.mjs';
import {config, effective} from './config.mjs';
import {checkpoint, createWorktree} from './git.mjs';
import {DOCUMENT_FILE} from './context.mjs';
import {newActivity, track} from './activity.mjs';
import {nextToStart} from './queue.mjs';
import {wsOfTask, allTasks, outDir, contextOf} from './workspaces.mjs';
import {touch, flush} from './live.mjs';

const sessions = new Map(); // task id → Pi session
const controls = new Map(); // task id → the task's control object, shared with its Pi extension
const dialogs = new Map(); // task id → a pending extension dialog {id, resolve, fallback}

export const sessionOf = id => sessions.get(id);

// A run with no events for this long is shown as stalled; past the second limit with no tool running,
// Rumi restarts the step once on its own.
export const STALL_MS = 5 * 60_000,
  STALL_TOOL_MS = 15 * 60_000,
  AUTO_RESTART_MS = 10 * 60_000;
const RESTART_NOTE = 'Your previous step stopped making progress and Rumi restarted it. Continue the task from where you left off, then call finish.';

function control(t) {
  const ws = wsOfTask.get(t.id);
  const opts = effective(ws.folder);
  if (!controls.has(t.id))
    controls.set(t.id, {
      kind: t.kind,
      searchMin: kindOf(t.kind, ws.folder).searchMin,
      budget: {used: 0, queries: new Set()},
      cwd: workDir(t),
      outDir: outDir(t),
      contextWindow: 32768,
      turn: null,
      lastEventAt: Date.now(),
      restarts: 0,
      onFinish: h => {
        t.handback = h;
        t.result = h.answer;
        touch(t);
      },
      onAsk: q => {
        t.question = q;
        touch(t);
      },
    });
  // Settings can change between runs; the next run uses the current ones.
  Object.assign(controls.get(t.id), {
    search: opts.search,
    allowPrivate: opts.allowPrivateNetwork,
    approvals: kindOf(t.kind, ws.folder).needsFolder ? opts.approvals : 'off',
    // Only kinds that change files may write outside their task folder.
    editsProject: kindOf(t.kind, ws.folder).needsFolder,
  });
  return controls.get(t.id);
}

// Where the worker works: the task's worktree, the project folder, or its own task folder.
const workDir = t => t.worktree || t.projectDir || outDir(t);

// Pi extensions (Rumi's or opted-in packages) may ask the user something. Rumi shows it beside the task.
function uiFor(t) {
  const ask = (kind, data, fallback, opts) =>
    new Promise(resolve => {
      const id = randomUUID();
      const done = value => {
        if (dialogs.get(t.id)?.id !== id) return;
        dialogs.delete(t.id);
        t.dialog = null;
        touch(t);
        resolve(value);
      };
      dialogs.set(t.id, {id, resolve: done, fallback});
      t.dialog = {id, kind, ...data};
      touch(t);
      opts?.signal?.addEventListener('abort', () => done(fallback), {once: true});
      if (opts?.timeout) setTimeout(() => done(fallback), opts.timeout);
    });
  const none = () => {};
  return {
    select: (title, options, opts) => ask('select', {title, options}, undefined, opts),
    confirm: (title, message, opts) => ask('confirm', {title, message}, false, opts).then(v => v === true || v === 'yes'),
    input: (title, placeholder, opts) => ask('input', {title, placeholder}, undefined, opts),
    editor: (title, prefill) => ask('input', {title, prefill}, undefined),
    notify: (message, type) => {
      t.notice = {message: String(message).slice(0, 300), type, at: Date.now()};
      touch(t);
    },
    onTerminalInput: () => none,
    setStatus: none,
    setWorkingMessage: none,
    setWorkingVisible: none,
    setWorkingIndicator: none,
    setHiddenThinkingLabel: none,
    setWidget: none,
    setFooter: none,
    setHeader: none,
    setTitle: none,
    custom: async () => undefined,
    pasteToEditor: none,
    setEditorText: none,
    getEditorText: () => '',
    addAutocompleteProvider: none,
    setEditorComponent: none,
    getEditorComponent: () => undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({success: false, error: 'Rumi has no themes'}),
    getToolsExpanded: () => false,
    setToolsExpanded: none,
  };
}
export function answerDialog(t, id, value) {
  const d = dialogs.get(t.id);
  if (!d || d.id !== id) throw Error('That question is no longer waiting for an answer.');
  d.resolve(value);
}
const cancelDialog = t => {
  const d = dialogs.get(t.id);
  if (d) d.resolve(d.fallback);
};

function bind(t, s, ctl) {
  s.subscribe(e => {
    ctl.lastEventAt = Date.now();
    if (t.stalled) t.stalled = false;
    track((t.activity ||= newActivity()), e);
    if (e.type === 'message_start' && e.message?.role === 'assistant') {
      t.live = '';
      t.liveOpen = true;
    } else if (e.type === 'message_update' && e.assistantMessageEvent.type === 'text_delta') t.live = (t.live || '') + e.assistantMessageEvent.delta;
    else if (e.type === 'message_end') {
      t.liveOpen = false;
      t.version = (t.version || 0) + 1;
      addUsage(t, e.message);
    } else if (e.type === 'queue_update') t.steering = [...e.steering, ...e.followUp];
    else if (e.type === 'tool_execution_start') t.activeTool = e.toolName;
    else if (e.type === 'tool_execution_end') t.activeTool = null;
    else if (e.type === 'compaction_end') t.version = (t.version || 0) + 1;
    touch(t);
  });
}

// Tokens and cost, added up over the task's whole conversation, when the provider reports them.
function addUsage(t, m) {
  const u = m?.role === 'assistant' && m.usage;
  if (!u) return;
  const prev = t.usage || {input: 0, output: 0, cacheRead: 0, total: 0, cost: 0};
  t.usage = {
    input: prev.input + (u.input || 0),
    output: prev.output + (u.output || 0),
    cacheRead: prev.cacheRead + (u.cacheRead || 0),
    total: prev.total + (u.totalTokens || 0),
    cost: prev.cost + (u.cost?.total || 0),
  };
}

async function open(t, ctl) {
  const s = sessions.get(t.id);
  if (s) return s;
  const ws = wsOfTask.get(t.id);
  const opts = effective(ws.folder);
  ctl.contextWindow = resolveModel(t.model).contextWindow || 32768;
  const {session, errors} = await makeSession({
    ctl,
    sessionFile: t.sessionFile,
    modelRef: t.model,
    kind: t.kind,
    folder: t.worktree || t.projectDir,
    skillFolder: t.projectDir,
    outDir: outDir(t),
    sessionsDir: ws.store.sessionsDir,
    packages: ws.packages,
    mcp: ws.mcp || [],
    userSkills: !!config.userSkills,
    reasoning: opts.reasoning,
    uiContext: uiFor(t),
  });
  sessions.set(t.id, session);
  t.sessionFile = session.sessionFile;
  t.warnings = errors;
  bind(t, session, ctl);
  return session;
}

// Build tasks: their own worktree when that is on, otherwise a checkpoint of the project before the run.
async function prepareBuild(t) {
  const ws = wsOfTask.get(t.id);
  if (!t.projectDir || !kindOf(t.kind, ws.folder).needsFolder) return;
  const opts = effective(ws.folder);
  if (opts.worktrees && !t.worktree && !t.started) {
    t.worktree = await createWorktree(t.projectDir, t.id);
    t.notice = {message: `Working on its own branch in ${t.worktree}`, at: Date.now()};
  }
  if (!t.worktree && opts.checkpoints) {
    const before = await checkpoint(t.projectDir, `Before: ${t.title}`).catch(e => {
      t.warnings = [...(t.warnings || []), `Checkpoint failed: ${e.message}`];
      return null;
    });
    if (before) {
      t.checkpoints = [...(t.checkpoints || []), {before, at: new Date().toISOString()}];
      t.reverted = null;
    }
  }
}
async function finishBuild(t) {
  const last = t.checkpoints?.at(-1);
  if (!last || last.after || !t.projectDir) return;
  last.after = await checkpoint(t.projectDir, `After: ${t.title}`).catch(() => null);
}

async function run(t) {
  t.status = 'running';
  t.error = null;
  t.activity = newActivity();
  t.question = null;
  t.stalled = false;
  t.notice = null;
  t.runStartedAt = Date.now();
  touch(t);
  flush(t);
  const ctl = control(t);
  try {
    await prepareBuild(t);
    const s = await open(t, ctl);
    while (t.status === 'running' && (!t.started || t.pending.length || t.restart)) {
      const first = !t.started,
        batch = t.pending;
      t.pending = [];
      const parts = [first ? contextOf(t).initial : '', ...batch, t.restart ? RESTART_NOTE : ''];
      t.restart = false;
      const passageUpdate = batch.some(p => p.includes('<rumi-passage-update>'));
      // Every user message gets a fresh search budget. A hand-back is required for the delegation, a new
      // version of the passage, and any run while nothing has been handed back yet.
      ctl.budget.used = 0;
      ctl.budget.queries.clear();
      ctl.turn = {
        expectFinish: first || passageUpdate || !t.handback,
        requireResearch: (first || passageUpdate) && ctl.searchMin > 0,
        finished: false,
        asked: false,
        readWeb: false,
        nudged: {finish: 0, research: 0},
      };
      ctl.lastEventAt = Date.now();
      t.started = true;
      touch(t);
      // No time limit: a run lasts until it finishes, asks, or the user presses Stop.
      await s.prompt(parts.filter(Boolean).join('\n\n'));
    }
    // Snapshot what a Build run changed before the task shows as settled, so its changes are ready to review.
    await finishBuild(t).catch(() => {});
    if (t.status === 'running') settle(t, s, ctl);
  } catch (e) {
    if (t.status !== 'cancelled') {
      t.status = 'failed';
      t.error = e.message;
    }
  } finally {
    await finishBuild(t).catch(() => {});
    t.elapsed = (t.elapsed || 0) + (Date.now() - (t.runStartedAt || Date.now()));
    t.finishedAt = new Date().toISOString();
    t.liveOpen = false;
    t.activeTool = null;
    t.activity = null;
    t.steering = [];
    t.stalled = false;
    t.version = (t.version || 0) + 1;
    t.files = listFiles(t);
    touch(t);
    flush(t);
    pump();
  }
}

// How a run ends: waiting for the user, failed, or finished with a hand-back (or, failing that, its last reply).
function settle(t, s, ctl) {
  const turn = ctl.turn;
  const last = s.messages.filter(x => x.role === 'assistant').at(-1);
  if (turn?.asked) {
    t.status = 'needs-you';
    return;
  }
  if (last?.stopReason === 'error') {
    t.status = 'failed';
    t.error = last.errorMessage || 'The model returned an error.';
    return;
  }
  t.status = 'finished';
  if (turn?.finished) {
    if (t.source) t.suggestion = {state: 'pending', at: Date.now()};
  } else if (turn?.expectFinish) {
    // The worker never handed back, even after Rumi asked: offer its last reply instead, marked as such.
    t.handback = null;
    t.result = s.getLastAssistantText() || t.result;
    if (t.source && t.result) t.suggestion = {state: 'pending', at: Date.now()};
  }
}

export function listFiles(t) {
  try {
    const dir = outDir(t);
    return fs.readdirSync(dir).filter(n => n !== DOCUMENT_FILE && fs.statSync(path.join(dir, n)).isFile());
  } catch {
    return [];
  }
}

export function pump() {
  for (const t of nextToStart(
    allTasks().filter(t => !t.archived),
    config.maxWorkers,
    {sameFolder: !!config.sameFolder},
  ))
    void run(t);
}
export function enqueue(t) {
  if (t.status !== 'queued') {
    t.status = 'queued';
    t.queuedAt = new Date().toISOString();
  }
  touch(t);
  pump();
}

// Delivers a message: steered into a running task, otherwise continues its session (answering a question too).
export async function deliver(t, message) {
  const s = sessions.get(t.id);
  const ctl = controls.get(t.id);
  if (ctl) ctl.restarts = 0; // a new message earns a new automatic restart
  if (t.status === 'running' && s?.isStreaming) return s.steer(message);
  t.question = null;
  t.pending.push(message);
  if (t.status !== 'running') enqueue(t);
}

export async function stop(t) {
  const was = t.status;
  t.status = 'cancelled';
  t.pending = [];
  t.pendingContext = null;
  t.question = null;
  t.restart = false;
  cancelDialog(t);
  touch(t);
  const s = sessions.get(t.id);
  if (s) {
    s.clearQueue();
    if (was === 'running') await s.abort();
  }
  t.error = was === 'running' ? 'Stopped. Pi aborted the run; detached processes cannot be guaranteed stopped.' : null;
  touch(t);
  flush(t);
}

export function resume(t) {
  if (t.status === 'running') return;
  if (t.started && !t.pending.length) t.pending.push('Continue where you left off.');
  enqueue(t);
}

// Aborts the current step and starts it again in the same session.
export async function restartStep(t) {
  const s = sessions.get(t.id);
  if (t.status !== 'running' || !s) return resume(t);
  t.restart = true;
  t.stalled = false;
  cancelDialog(t);
  touch(t);
  await s.abort();
}

// Notices runs that stopped making progress.
setInterval(() => {
  for (const t of allTasks()) {
    if (t.status !== 'running' || t.dialog) continue;
    const ctl = controls.get(t.id);
    if (!ctl) continue;
    const quiet = Date.now() - ctl.lastEventAt;
    if (!t.stalled && quiet > (t.activeTool ? STALL_TOOL_MS : STALL_MS)) {
      t.stalled = true;
      touch(t);
    }
    if (!t.activeTool && quiet > AUTO_RESTART_MS && ctl.restarts < 1 && sessions.get(t.id)?.isStreaming) {
      ctl.restarts++;
      void restartStep(t);
    }
  }
}, 30_000).unref();

// Sessions that are idle can be dropped (e.g. after the model connection changes); they reopen from disk.
export function dropIdleSessions() {
  for (const [id, s] of sessions) {
    const t = allTasks().find(x => x.id === id);
    if (t?.status === 'running' || s.isStreaming) continue;
    s.dispose();
    sessions.delete(id);
    controls.delete(id);
  }
}
