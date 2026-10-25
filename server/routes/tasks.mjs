// Tasks: delegating, the conversation, steering and answering, and what a Build task changed (review, revert, merge).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as host from '../runtime.mjs';
import {effective} from '../config.mjs';
import {kindFor, kindOf} from '../../pi/kinds.mjs';
import {
  buildBrief,
  buildContextUpdate,
  buildDelegation,
  buildPassageUpdate,
  contextBudget,
  defaultInstruction,
  documentBackground,
  DOCUMENT_FILE,
  titleFrom,
} from '../context.mjs';
import {legacyConversation, readSessionEntries, toConversation} from '../conversation.mjs';
import {contextOf, docMeta, docOf, findTask, outDir, readmeOf, saveContext, saveState, state, wsOfTask} from '../workspaces.mjs';
import {flush, summary, touch, broadcast} from '../live.mjs';
import {answerDialog, deliver, listFiles, pump, restartStep, resume, sessionOf, stop} from '../worker.mjs';
import {changes, discardWorktree, mergeWorktree, restoreCheckpoint, worktreeChanges} from '../git.mjs';
import {dataDir} from '../paths.mjs';
import {fail, handle, taskParam, wsParam} from './common.mjs';

const router = express.Router();

// Builds the document background for a task from its document and records what was supplied.
function supplyContext(t, {offset, kind}) {
  const ws = wsOfTask.get(t.id);
  const doc = (t.docId && docOf(ws, t.docId)) || {text: '', revision: 0};
  const bg = documentBackground(doc.text, {passage: t.source || '', offset, budget: contextBudget(host.resolveModel(t.model))});
  fs.mkdirSync(outDir(t), {recursive: true});
  if (bg.shortened) fs.writeFileSync(path.join(outDir(t), DOCUMENT_FILE), doc.text);
  const ctx = contextOf(t);
  ctx.supplied.push({at: new Date().toISOString(), kind, revision: doc.revision, shortened: bg.shortened, length: bg.length, text: bg.text});
  return {bg, ctx};
}

// Creates and queues a task. Shared by the Delegate box, "Run again", and `rumi delegate`.
function createTask(ws, {selection, offset, instruction, model, kind: wanted, docId, group, label}) {
  const kind = kindFor(wanted ?? state.lastKind, {hasFolder: !!ws.folder, folder: ws.folder});
  if (docId && !docMeta(ws, docId)) throw Error('That document no longer exists.');
  const passage = selection?.trim() ? selection : '';
  const modelRef = model || effective(ws.folder).defaultModel;
  host.resolveModel(modelRef);
  const objective = instruction?.trim() || defaultInstruction(passage);
  const id = randomUUID();
  const t = {
    id,
    title: label
      ? `${String(label).slice(0, 40)}: ${titleFrom(passage || docMeta(ws, docId)?.title || 'whole document', 48)}`
      : titleFrom(instruction?.trim() || passage || docMeta(ws, docId)?.title || 'Whole document'),
    objective,
    source: passage,
    kind,
    model: modelRef,
    projectDir: ws.folder || undefined,
    docId: docId || null,
    group: group || id,
    outputDir: ws.store.outputDir(id),
    status: 'queued',
    pending: [],
    started: false,
    files: [],
    log: [],
    updates: [],
    created: new Date().toISOString(),
    version: 0,
  };
  wsOfTask.set(id, ws);
  const {bg, ctx} = supplyContext(t, {offset, kind: 'delegation'});
  ctx.initial = buildDelegation({
    instruction: objective,
    passage,
    background: bg,
    projectDir: t.projectDir,
    outputDir: outDir(t),
    kind,
    guide: kindOf(kind, ws.folder).guide,
    brief: buildBrief({readme: readmeOf(ws)}),
  });
  saveContext(t, ctx);
  if (state.lastKind !== kind) {
    state.lastKind = kind;
    saveState();
  }
  t.queuedAt = t.created;
  ws.tasks.unshift(t);
  touch(t);
  flush(t);
  pump();
  return t;
}

router.post(
  '/w/:wid/tasks',
  handle((q, r) => {
    const ws = wsParam(q, r);
    if (!ws) return;
    const b = q.body || {};
    r.json(summary(createTask(ws, {...b, kind: b.kind ?? (b.research === false ? 'write' : undefined)})));
  }),
);

// The same request again, on another model, to compare the answers side by side.
router.post(
  '/tasks/:id/rerun',
  handle((q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    const ws = wsOfTask.get(t.id);
    const copy = createTask(ws, {
      selection: t.source,
      instruction: t.objective,
      model: q.body?.model || t.model,
      kind: t.kind,
      docId: t.docId,
      group: t.group || t.id,
    });
    if (!t.group) {
      t.group = t.id;
      touch(t);
    }
    r.json(summary(copy));
  }),
);

router.get('/tasks/:id', (q, r) => {
  const t = taskParam(q, r);
  if (!t) return;
  let items;
  try {
    const entries = readSessionEntries(t.sessionFile, sessionOf(t.id));
    items = entries ? toConversation(entries) : t.started ? legacyConversation(t) : [];
  } catch (e) {
    items = legacyConversation(t);
    items.unshift({role: 'note', text: `Pi session could not be read: ${e.message}`});
  }
  r.json({id: t.id, version: t.version || 0, objective: t.objective, source: t.source, items, contexts: contextOf(t).supplied});
});

// The task as the task list shows it (status, hand-back), without its conversation. `rumi delegate --wait` polls this.
router.get('/tasks/:id/summary', (q, r) => {
  const t = taskParam(q, r);
  if (t) r.json(summary(t));
});

router.patch('/tasks/:id', (q, r) => {
  const t = taskParam(q, r);
  if (!t) return;
  if (q.body?.archived !== undefined) t.archived = !!q.body.archived;
  if (typeof q.body?.title === 'string' && q.body.title.trim()) t.title = q.body.title.trim().slice(0, 120);
  touch(t);
  flush(t);
  r.json(summary(t));
});

// Deletes a task: its conversation, context and output files. A worktree it had is removed with its branch.
router.delete(
  '/tasks/:id',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    const ws = wsOfTask.get(t.id);
    if (['running', 'queued'].includes(t.status)) await stop(t);
    if (t.worktree && t.projectDir) await discardWorktree(t.projectDir, t.id).catch(() => {});
    const inside = (file, dir) => !path.relative(dir, file).startsWith('..');
    const dir = outDir(t);
    if (inside(dir, ws.store.dir) || inside(dir, dataDir)) fs.rmSync(dir, {recursive: true, force: true});
    if (t.sessionFile && fs.existsSync(t.sessionFile) && inside(t.sessionFile, ws.store.sessionsDir)) fs.rmSync(t.sessionFile, {force: true});
    ws.store.del(`context:${t.id}`);
    ws.tasks = ws.tasks.filter(x => x.id !== t.id);
    wsOfTask.delete(t.id);
    ws.persist();
    ws.persist.flush();
    broadcast();
    r.json({ok: true});
  }),
);

const needsModel = t => {
  try {
    host.resolveModel(t.model);
    return null;
  } catch (e) {
    return Error(`${e.message} This task stays on its original model.`);
  }
};

// Running: steer the current run. Otherwise: continue the same session (this also answers a question).
router.post(
  '/tasks/:id/messages',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    const text = q.body?.text?.trim();
    if (!text) return r.status(400).json({error: 'The message is empty.'});
    const e = needsModel(t);
    if (e) return fail(r, 400, e);
    const message = t.pendingContext ? buildContextUpdate(t.pendingContext, text) : text;
    t.pendingContext = null;
    t.archived = false;
    await deliver(t, message);
    touch(t);
    r.json(summary(t));
  }),
);

// Sends the current document as fresh background. Mid-run it is steered in; otherwise it travels with the next message.
router.post(
  '/tasks/:id/context',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    const {bg, ctx} = supplyContext(t, {kind: 'update'});
    saveContext(t, ctx);
    const s = sessionOf(t.id);
    if (t.status === 'running' && s?.isStreaming) {
      await s.steer(buildContextUpdate(bg));
      t.pendingContext = null;
    } else t.pendingContext = bg;
    touch(t);
    r.json(summary(t));
  }),
);

// The linked passage was edited in the document and the user chose to send the new version.
router.post(
  '/tasks/:id/passage',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    const text = q.body?.text?.trim();
    if (!text) return r.status(400).json({error: 'The passage is empty.'});
    const e = needsModel(t);
    if (e) return fail(r, 400, e);
    t.source = text;
    t.suggestion = null;
    await deliver(t, buildPassageUpdate(text));
    touch(t);
    flush(t);
    r.json(summary(t));
  }),
);

// Accept or dismiss the answer offered at the passage.
router.post('/tasks/:id/suggestion', (q, r) => {
  const t = taskParam(q, r);
  if (!t) return;
  if (!['accepted', 'dismissed'].includes(q.body?.state)) return r.status(400).json({error: 'accepted or dismissed'});
  if (t.suggestion) t.suggestion.state = q.body.state;
  // The answer replaced the passage: it becomes the passage the task is about.
  if (typeof q.body.passage === 'string' && q.body.passage.trim()) t.source = q.body.passage;
  touch(t);
  flush(t);
  r.json(summary(t));
});

// The answer to a question a Pi extension asked (confirm, select, input), or Rumi's own command approval.
router.post('/tasks/:id/dialog', (q, r) => {
  const t = taskParam(q, r);
  if (!t) return;
  try {
    answerDialog(t, q.body?.id, q.body?.value);
    r.json(summary(t));
  } catch (e) {
    fail(r, 409, e);
  }
});

router.post(
  '/tasks/:id/stop',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    await stop(t);
    r.json(summary(t));
  }),
);
router.post('/tasks/:id/resume', (q, r) => {
  const t = taskParam(q, r);
  if (!t) return;
  resume(t);
  r.json(summary(t));
});
router.post(
  '/tasks/:id/restart',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    await restartStep(t);
    r.json(summary(t));
  }),
);

// --- what a Build task changed ---
router.get(
  '/tasks/:id/changes',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    if (t.worktree) return r.json({mode: 'worktree', ...(await worktreeChanges(t.projectDir, t.id))});
    const first = t.checkpoints?.[0],
      last = t.checkpoints?.at(-1);
    if (!first) return r.json({mode: 'none', files: []});
    if (!last.after) return r.json({mode: 'checkpoint', running: true, files: []});
    r.json({mode: 'checkpoint', reverted: t.reverted || null, ...(await changes(t.projectDir, first.before, last.after))});
  }),
);

// Puts the project back as it was before the task's first run. The state just before reverting is kept, so it can be undone.
router.post(
  '/tasks/:id/revert',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    if (t.status === 'running') return r.status(409).json({error: 'Stop the task before reverting its changes.'});
    const first = t.checkpoints?.[0];
    if (!first) return r.status(400).json({error: 'This task has no checkpoint to go back to.'});
    const undo = await restoreCheckpoint(t.projectDir, first.before, `Before reverting: ${t.title}`);
    t.reverted = {at: new Date().toISOString(), undo};
    touch(t);
    flush(t);
    r.json(summary(t));
  }),
);
router.post(
  '/tasks/:id/unrevert',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    if (!t.reverted?.undo) return r.status(400).json({error: 'There is no revert to undo.'});
    await restoreCheckpoint(t.projectDir, t.reverted.undo, `Before undoing the revert: ${t.title}`);
    t.reverted = null;
    touch(t);
    flush(t);
    r.json(summary(t));
  }),
);

router.post(
  '/tasks/:id/merge',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    if (!t.worktree) return r.status(400).json({error: 'This task has no worktree.'});
    if (t.status === 'running') return r.status(409).json({error: 'Stop the task before merging.'});
    await mergeWorktree(t.projectDir, t.id, t.title);
    t.merged = new Date().toISOString();
    t.worktree = null;
    t.notice = {message: 'Merged into your branch.', at: Date.now()};
    touch(t);
    flush(t);
    r.json(summary(t));
  }),
);
router.post(
  '/tasks/:id/discard',
  handle(async (q, r) => {
    const t = taskParam(q, r);
    if (!t) return;
    if (!t.worktree) return r.status(400).json({error: 'This task has no worktree.'});
    if (t.status === 'running') await stop(t);
    await discardWorktree(t.projectDir, t.id);
    t.worktree = null;
    t.notice = {message: 'Its branch and worktree were discarded.', at: Date.now()};
    touch(t);
    flush(t);
    r.json(summary(t));
  }),
);

const textTypes = new Set(['.md', '.txt', '.csv', '.json', '.html', '.log', '.yaml', '.yml', '.xml']);
router.get('/tasks/:id/files/:name', (q, r) => {
  const t = findTask(q.params.id),
    name = q.params.name;
  if (!t || path.basename(name) !== name || !listFiles(t).includes(name)) return r.sendStatus(404);
  const file = path.join(outDir(t), name);
  if (q.query.view !== undefined && textTypes.has(path.extname(name).toLowerCase())) {
    r.type('text/plain; charset=utf-8');
    r.set('Content-Security-Policy', "default-src 'none'");
    return r.sendFile(file);
  }
  r.download(file);
});

export {createTask};
export default router;
