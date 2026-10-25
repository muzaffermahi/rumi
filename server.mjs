// Rumi's local server: the HTTP API for the interface. The work happens in lib/ —
// workspaces.mjs (documents and briefs), context.mjs (what a worker is sent), worker.mjs (running tasks),
// live.mjs (updates to the browser), connections.mjs (models and sign-ins) — and in pi/, Rumi's Pi extension.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as host from './runtime.mjs';
import {KINDS, kindFor} from './pi/kinds.mjs';
import {buildDelegation, buildBrief, buildContextUpdate, buildPassageUpdate, documentBackground, contextBudget, titleFrom, defaultInstruction, DOCUMENT_FILE} from './lib/context.mjs';
import {toConversation, readSessionEntries, legacyConversation} from './lib/conversation.mjs';
import {describeFolder, remember, pickFolder, canPick} from './lib/folders.mjs';
import {GLOBAL, workspaceId} from './lib/store.mjs';
import {settings, saveSettings, workspaces, wsOfTask, loadWorkspace, workspaceById, workspaceList, wsInfo, findTask, outDir, contextOf, saveContext, saveDocument, saveBrief, savePackages, readmeOf} from './lib/workspaces.mjs';
import {clients, summary, snapshot, broadcast, touch, flush, addToSnapshot} from './lib/live.mjs';
import {sessionOf, pump, deliver, stop, resume, restartStep, answerDialog, listFiles, dropIdleSessions} from './lib/worker.mjs';
import * as conn from './lib/connections.mjs';

const port = Number(process.env.RUMI_PORT || 4317);
const app = express();
// Only this machine's browser, on this port, may talk to Rumi.
app.use((req, res, next) => {
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return res.sendStatus(403);
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return res.sendStatus(403);
  next();
});
app.use(express.json({limit: '8mb'}));

await host.loadRuntime();
// Ready means at least one model is connected and the default model is one of them.
const ready = () => { const m = host.knownModels(); return m.length > 0 && m.some(x => x.ref === settings.defaultModel); };
addToSnapshot(() => ({ready: ready(), kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, {label: v.label, hint: v.hint, needsFolder: !!v.needsFolder}]))}));

// After connecting something: pick a default model if there is none yet, and tell every page.
async function modelsChanged() {
  const models = await host.listModels();
  if (models.length && !models.some(m => m.ref === settings.defaultModel)) { settings.defaultModel = preferredModel(models); saveSettings(); }
  dropIdleSessions();
  broadcast();
}
// When the user has several: a subscription they already pay for before pay-per-use keys, a capable model
// before a small one, hosted before local.
function preferredModel(models) {
  const flat = m => host.runtime.isUsingSubscription(m.provider) || m.provider === 'opencode-go';
  const rank = m => (flat(m) ? 0 : 4) + (/opus|sonnet|gpt-5|grok-4|gemini-2\.5-pro|kimi-k2|glm-5|deepseek/i.test(m.id) ? 0 : 1) + (['lmstudio', 'ollama'].includes(m.provider) ? 2 : 0);
  return [...models].sort((a, b) => rank(a) - rank(b))[0].ref;
}

// First start with models already available (environment keys, shared Pi sign-ins): choose a default right away.
if (!settings.defaultModel && host.knownModels().length) { settings.defaultModel = preferredModel(host.knownModels()); saveSettings(); }

// Builds the document background for a task from its workspace's document and records what was supplied.
function supplyContext(t, {offset, kind}) {
  const doc = wsOfTask.get(t.id).document;
  const bg = documentBackground(doc.text, {passage: t.source || '', offset, budget: contextBudget(host.resolveModel(t.model))});
  fs.mkdirSync(outDir(t), {recursive: true});
  if (bg.shortened) fs.writeFileSync(path.join(outDir(t), DOCUMENT_FILE), doc.text);
  const ctx = contextOf(t);
  ctx.supplied.push({at: new Date().toISOString(), kind, revision: doc.revision, shortened: bg.shortened, length: bg.length, text: bg.text});
  return {bg, ctx};
}

const fail = (r, status, e) => r.status(status).json({error: e.message || String(e)});
const wsParam = (q, r) => { const ws = workspaceById(q.params.wid); if (!ws) r.status(404).json({error: 'That workspace is no longer available.'}); return ws; };
const taskParam = (q, r) => { const t = findTask(q.params.id); if (!t) r.sendStatus(404); return t; };

app.get('/api/health', (q, r) => r.json({rumi: true, data: host.root}));

// --- live updates ---
app.get('/api/events', (q, r) => {
  const ws = workspaceById(q.query.w || GLOBAL) || workspaces.get(GLOBAL);
  r.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
  r.flushHeaders();
  const c = {res: r, ws};
  clients.add(c);
  r.write(`data: ${JSON.stringify(snapshot(ws))}\n\n`);
  const timer = setInterval(() => r.write(': heartbeat\n\n'), 15000);
  q.on('close', () => { clearInterval(timer); clients.delete(c); });
});

// --- workspaces, documents, briefs ---
app.get('/api/workspaces', (q, r) => r.json(workspaceList()));
// Opening a folder (from the switcher or the `rumi` command) creates <folder>/.rumi on first use.
app.post('/api/workspaces/open', (q, r) => {
  const f = describeFolder(q.body?.path);
  if (!f.exists) return r.status(400).json({error: `Folder not found: ${f.path}`});
  let ws;
  try { ws = loadWorkspace(workspaceId(f.path), f.path); } catch (e) { return r.status(500).json({error: `Could not open ${f.path}: ${e.message}`}); }
  settings.recentFolders = remember(settings.recentFolders, f);
  saveSettings(); broadcast();
  r.json({workspace: wsInfo(ws)});
});
app.get('/api/w/:wid/document', (q, r) => { const ws = wsParam(q, r); if (ws) r.json(ws.document); });
app.put('/api/w/:wid/document', (q, r) => {
  const ws = wsParam(q, r); if (!ws) return;
  if (typeof q.body.html !== 'string') return r.sendStatus(400);
  r.json({revision: saveDocument(ws, q.body).revision});
});
app.put('/api/w/:wid/brief', (q, r) => { const ws = wsParam(q, r); if (!ws) return; saveBrief(ws, q.body?.brief); broadcast(); r.json(wsInfo(ws)); });
app.put('/api/w/:wid/packages', (q, r) => {
  const ws = wsParam(q, r); if (!ws) return;
  const installed = new Set(settings.packages.map(p => p.source));
  const sources = (q.body?.sources || []).filter(s => installed.has(s));
  savePackages(ws, sources); broadcast(); r.json(wsInfo(ws));
});

// --- folders ---
let picking = false;
app.post('/api/folders/pick', async (q, r) => {
  if (picking) return r.status(409).json({error: 'A folder picker is already open on your screen.'});
  picking = true;
  try { const chosen = await pickFolder(q.body?.start); r.json(chosen ? {folder: describeFolder(chosen)} : {cancelled: true}); }
  catch (e) { fail(r, canPick ? 500 : 501, e); }
  finally { picking = false; }
});
app.post('/api/folders/check', (q, r) => { const f = describeFolder(q.body?.path); if (!f.exists) return r.status(400).json({error: `Folder not found: ${f.path}`}); r.json({folder: f}); });
app.post('/api/folders/forget', (q, r) => { settings.recentFolders = (settings.recentFolders || []).filter(f => f.path !== q.body?.path); saveSettings(); broadcast(); r.json(settings); });

// --- settings ---
app.put('/api/settings', (q, r) => {
  const {defaultModel, maxWorkers, sameFolder, reasoning, userSkills, lastKind} = q.body;
  if (sameFolder !== undefined) settings.sameFolder = !!sameFolder;
  if (userSkills !== undefined) { settings.userSkills = !!userSkills; dropIdleSessions(); }
  if (reasoning !== undefined) { if (!['auto', 'off'].includes(reasoning)) return r.status(400).json({error: 'Reasoning is auto or off.'}); settings.reasoning = reasoning; dropIdleSessions(); }
  if (lastKind !== undefined && KINDS[lastKind]) settings.lastKind = lastKind;
  if (defaultModel !== undefined) { try { host.resolveModel(defaultModel); } catch (e) { return fail(r, 400, e); } settings.defaultModel = defaultModel; }
  if (maxWorkers !== undefined) { const n = Number(maxWorkers); if (![1, 2, 3].includes(n)) return r.status(400).json({error: 'Tasks at once must be 1, 2 or 3.'}); settings.maxWorkers = n; }
  saveSettings(); broadcast(); pump();
  r.json(settings);
});

// --- models and connections ---
app.get('/api/models', async (q, r) => r.json({models: await host.listModels()}));
app.get('/api/setup', async (q, r) => { try { r.json({...await conn.status(), defaultModel: settings.defaultModel, ready: ready()}); } catch (e) { fail(r, 500, e); } });
app.post('/api/connections/mode', async (q, r) => {
  try { await host.setConnectionMode(q.body?.mode); await modelsChanged(); r.json(await conn.status()); } catch (e) { fail(r, 400, e); }
});
app.post('/api/connections/login', (q, r) => { try { r.json(conn.startLogin(q.body?.provider, q.body?.type, modelsChanged)); } catch (e) { fail(r, 400, e); } });
app.get('/api/connections/login/:id', (q, r) => { try { r.json(conn.getLogin(q.params.id)); } catch (e) { fail(r, 404, e); } });
app.post('/api/connections/login/:id/answer', (q, r) => { try { r.json(conn.answerLogin(q.params.id, q.body?.promptId, q.body?.value)); } catch (e) { fail(r, 400, e); } });
app.post('/api/connections/login/:id/cancel', (q, r) => { try { r.json(conn.cancelLogin(q.params.id)); } catch (e) { fail(r, 404, e); } });
app.post('/api/connections/logout', async (q, r) => { try { await conn.logout(q.body?.provider); await modelsChanged(); r.json(await conn.status()); } catch (e) { fail(r, 400, e); } });
app.post('/api/connections/local', async (q, r) => { try { await host.connectLocal(q.body?.id); await modelsChanged(); r.json(await conn.status()); } catch (e) { fail(r, 400, e); } });
app.delete('/api/connections/local/:id', async (q, r) => { try { await host.forgetLocal(q.params.id); await modelsChanged(); r.json(await conn.status()); } catch (e) { fail(r, 400, e); } });

// --- Pi packages (installed in Rumi's own Pi home; enabled per workspace) ---
app.get('/api/packages', (q, r) => r.json({installed: settings.packages, fromPi: host.piPackages().filter(p => !settings.packages.some(x => x.source === p.source))}));
app.post('/api/packages', async (q, r) => {
  const name = String(q.body?.name || '').trim();
  if (!/^(npm:|git:|https?:)?[@\w./:#-]+$/.test(name)) return r.status(400).json({error: 'Enter a package name, like pi-lens.'});
  try {
    const p = await host.installPackage(host.packageSource(name));
    settings.packages = [...settings.packages.filter(x => x.source !== p.source), {source: p.source, name: p.name, version: p.version, description: p.description}];
    saveSettings(); broadcast(); r.json({installed: settings.packages});
  } catch (e) { fail(r, 400, Error(`Could not install ${name}: ${e.message}`)); }
});
app.delete('/api/packages', async (q, r) => {
  const source = q.body?.source;
  try { await host.removePackage(source); } catch {}
  settings.packages = settings.packages.filter(p => p.source !== source);
  for (const ws of workspaces.values()) if (ws.packages.includes(source)) savePackages(ws, ws.packages.filter(s => s !== source));
  saveSettings(); dropIdleSessions(); broadcast(); r.json({installed: settings.packages});
});

// `rumi stop`, or Quit in Settings. A custom header can't be sent cross-origin without a preflight, which the origin check refuses.
app.post('/api/shutdown', (q, r) => {
  if (q.get('X-Rumi-CLI') !== '1' && q.get('X-Rumi-UI') !== '1') return r.sendStatus(403);
  r.json({ok: true});
  for (const ws of workspaces.values()) ws.persist.flush();
  setTimeout(() => process.exit(0), 100);
});

// --- tasks ---
app.post('/api/w/:wid/tasks', (q, r) => {
  const ws = wsParam(q, r); if (!ws) return;
  const {selection, offset, instruction, model} = q.body;
  let kind;
  try { kind = kindFor(q.body.kind ?? (q.body.research === false ? 'write' : settings.lastKind), {hasFolder: !!ws.folder}); } catch (e) { return fail(r, 400, e); }
  const passage = selection?.trim() ? selection : '';
  const modelRef = model || settings.defaultModel;
  try { host.resolveModel(modelRef); } catch (e) { return fail(r, 400, e); }
  const objective = instruction?.trim() || defaultInstruction(passage);
  const id = randomUUID();
  const t = {id, title: titleFrom(instruction?.trim() || passage || 'Whole document'), objective, source: passage, kind, model: modelRef, projectDir: ws.folder || undefined,
    outputDir: ws.store.outputDir(id), status: 'queued', pending: [], started: false, files: [], log: [], updates: [], created: new Date().toISOString(), version: 0};
  wsOfTask.set(id, ws);
  const {bg, ctx} = supplyContext(t, {offset, kind: 'delegation'});
  ctx.initial = buildDelegation({instruction: objective, passage, background: bg, projectDir: t.projectDir, outputDir: outDir(t), kind, brief: buildBrief({brief: ws.brief, readme: readmeOf(ws)})});
  saveContext(t, ctx);
  if (settings.lastKind !== kind) { settings.lastKind = kind; saveSettings(); }
  t.queuedAt = t.created;
  ws.tasks.unshift(t);
  touch(t); flush(t); pump();
  r.json(summary(t));
});

app.get('/api/tasks/:id', (q, r) => {
  const t = taskParam(q, r); if (!t) return;
  let items;
  try { const entries = readSessionEntries(t.sessionFile, sessionOf(t.id)); items = entries ? toConversation(entries) : t.started ? legacyConversation(t) : []; }
  catch (e) { items = legacyConversation(t); items.unshift({role: 'note', text: `Pi session could not be read: ${e.message}`}); }
  r.json({id: t.id, version: t.version || 0, objective: t.objective, source: t.source, items, contexts: contextOf(t).supplied});
});

// Running: steer the current run. Otherwise: continue the same session (this also answers a question).
app.post('/api/tasks/:id/messages', async (q, r) => {
  const t = taskParam(q, r); if (!t) return;
  const text = q.body.text?.trim();
  if (!text) return r.sendStatus(400);
  try { host.resolveModel(t.model); } catch (e) { return fail(r, 400, Error(`${e.message} This task stays on its original model.`)); }
  const message = t.pendingContext ? buildContextUpdate(t.pendingContext, text) : text;
  t.pendingContext = null;
  await deliver(t, message);
  touch(t);
  r.json(summary(t));
});

// Sends the current document as fresh background. Mid-run it is steered in; otherwise it travels with the next message.
app.post('/api/tasks/:id/context', async (q, r) => {
  const t = taskParam(q, r); if (!t) return;
  let bg, ctx;
  try { ({bg, ctx} = supplyContext(t, {kind: 'update'})); } catch (e) { return fail(r, 400, e); }
  saveContext(t, ctx);
  const s = sessionOf(t.id);
  if (t.status === 'running' && s?.isStreaming) { await s.steer(buildContextUpdate(bg)); t.pendingContext = null; }
  else t.pendingContext = bg;
  touch(t);
  r.json(summary(t));
});

// The linked passage was edited in the document and the user chose to send the new version.
app.post('/api/tasks/:id/passage', async (q, r) => {
  const t = taskParam(q, r); if (!t) return;
  const text = q.body.text?.trim();
  if (!text) return r.sendStatus(400);
  try { host.resolveModel(t.model); } catch (e) { return fail(r, 400, Error(`${e.message} This task stays on its original model.`)); }
  t.source = text; t.suggestion = null;
  await deliver(t, buildPassageUpdate(text));
  touch(t); flush(t);
  r.json(summary(t));
});

// Accept or dismiss the answer offered at the passage.
app.post('/api/tasks/:id/suggestion', (q, r) => {
  const t = taskParam(q, r); if (!t) return;
  if (!['accepted', 'dismissed'].includes(q.body.state)) return r.sendStatus(400);
  if (t.suggestion) t.suggestion.state = q.body.state;
  touch(t); flush(t);
  r.json(summary(t));
});

// The answer to a question a Pi extension asked (confirm, select, input).
app.post('/api/tasks/:id/dialog', (q, r) => {
  const t = taskParam(q, r); if (!t) return;
  try { answerDialog(t, q.body?.id, q.body?.value); r.json(summary(t)); } catch (e) { fail(r, 409, e); }
});

app.post('/api/tasks/:id/stop', async (q, r) => { const t = taskParam(q, r); if (!t) return; await stop(t); r.json(summary(t)); });
app.post('/api/tasks/:id/resume', (q, r) => { const t = taskParam(q, r); if (!t) return; resume(t); r.json(summary(t)); });
app.post('/api/tasks/:id/restart', async (q, r) => { const t = taskParam(q, r); if (!t) return; await restartStep(t); r.json(summary(t)); });

const textTypes = new Set(['.md', '.txt', '.csv', '.json', '.html', '.log', '.yaml', '.yml', '.xml']);
app.get('/api/tasks/:id/files/:name', (q, r) => {
  const t = findTask(q.params.id), name = q.params.name;
  if (!t || path.basename(name) !== name || !listFiles(t).includes(name)) return r.sendStatus(404);
  const file = path.join(outDir(t), name);
  if (q.query.view !== undefined && textTypes.has(path.extname(name).toLowerCase())) {
    r.type('text/plain; charset=utf-8');
    r.set('Content-Security-Policy', "default-src 'none'");
    return r.sendFile(file);
  }
  r.download(file);
});

app.use(express.static(path.join(host.appDir, 'dist')));
app.use((err, q, r, next) => { console.error(err.message); r.status(500).json({error: err.message}); });
pump();
const server = app.listen(port, '127.0.0.1', () => console.log(`Rumi http://127.0.0.1:${port}  (data: ${host.root}, sign-ins: ${host.connections.mode === 'pi' ? 'shared with Pi' : "Rumi's own"})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const ws of workspaces.values()) ws.persist.flush(); server.close(); process.exit(0); });
