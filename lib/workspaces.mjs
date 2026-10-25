// Workspaces: the Global one and one per project folder, each with its own document, brief and tasks.
// Settings that apply to the whole app live in the Global workspace's store.
import fs from 'node:fs';
import path from 'node:path';
import {root, taskDir, fallbackModel} from '../runtime.mjs';
import {titleFrom} from './context.mjs';
import {htmlToText} from './text.mjs';
import {throttle} from './queue.mjs';
import {describeFolder} from './folders.mjs';
import {GLOBAL, openStore, workspaceId, projectDataDir} from './store.mjs';
import {legacyKind} from '../pi/kinds.mjs';

export {GLOBAL};

// The global workspace is the original data/ folder (v1/v2 data stays where it was).
export const globalStore = openStore(root);
if (!globalStore.fresh && !globalStore.get('meta')) {
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `rumi-v1-${Date.now()}.sqlite`);
  globalStore.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log('Backed up v1 data to', file);
}
globalStore.put('meta', {version: 4});

export const settings = {
  recentFolders: [], defaultModel: fallbackModel, maxWorkers: Number(process.env.RUMI_MAX_WORKERS || 2),
  reasoning: 'auto',   // 'off' for local models that struggle with thinking
  userSkills: false,   // also offer the skills in ~/.agents/skills
  packages: [],        // Pi packages installed in Rumi's own Pi home: {source, name, version, description}
  lastKind: 'research',
  ...globalStore.get('settings'),
};
export const saveSettings = () => globalStore.put('settings', settings);

// Live-only task fields, never written to disk.
export const TRANSIENT = ['live', 'liveOpen', 'activeTool', 'steering', 'activity', 'timedOut', 'stalled', 'dialog', 'notice'];

export const workspaces = new Map();
export const wsOfTask = new Map();

export function loadWorkspace(id, folder) {
  if (workspaces.has(id)) return workspaces.get(id);
  const store = folder ? openStore(projectDataDir(folder), {project: true}) : globalStore;
  const info = folder ? describeFolder(folder) : null;
  const document = store.get('document') || {html: '', text: '', revision: 0};
  document.text ??= htmlToText(document.html);
  const ws = {id, folder: folder || null, name: info?.name || 'Global', isRepo: !!info?.isRepo, store, document, tasks: store.get('tasks') || [],
    brief: store.get('brief') || '', packages: store.get('packages') || []};
  ws.persist = throttle(() => store.put('tasks', ws.tasks.map(t => Object.fromEntries(Object.entries(t).filter(([k]) => !TRANSIENT.includes(k))))), 2000);
  ws.hasReadme = !!readmeOf(ws);
  for (const t of ws.tasks) { migrate(t, store); wsOfTask.set(t.id, ws); }
  store.put('tasks', ws.tasks);
  workspaces.set(id, ws);
  return ws;
}

function migrate(t, store) {
  // Additive only: fields from earlier versions are kept.
  t.title ??= titleFrom(t.context?.instruction || t.source || t.objective);
  t.pending ??= [];
  t.started ??= !!t.sessionFile;
  t.model ??= modelFromSession(t.sessionFile) || fallbackModel;
  t.files ??= [];
  t.kind ??= legacyKind(t);
  if (!store.get(`context:${t.id}`) && t.context?.background) store.put(`context:${t.id}`, {supplied: [{at: t.created, kind: 'delegation', revision: t.context.documentRevision, shortened: true, text: t.context.background, note: 'v1 sent the first 6,000 characters of the document.'}]});
  if (['running', 'queued'].includes(t.status)) { t.status = 'interrupted'; t.error = 'Rumi restarted. Send a message or resume to continue.'; }
  for (const k of TRANSIENT) delete t[k];
}
function modelFromSession(file) {
  try { for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const e = JSON.parse(line); if (e.type === 'model_change') return `${e.provider}/${e.modelId}`; } } catch {}
  return null;
}

loadWorkspace(GLOBAL, null);

export const wsInfo = ws => ({id: ws.id, name: ws.name, path: ws.folder, isRepo: ws.isRepo, brief: ws.brief, packages: ws.packages, readme: ws.hasReadme});
export const workspaceList = () => [{id: GLOBAL, name: 'Global', path: null, isRepo: false}, ...(settings.recentFolders || []).map(f => ({id: workspaceId(f.path), name: f.name, path: f.path, isRepo: f.isRepo}))];
export function workspaceById(id) {
  if (workspaces.has(id)) return workspaces.get(id);
  const f = (settings.recentFolders || []).find(f => workspaceId(f.path) === id);
  return f && describeFolder(f.path).exists ? loadWorkspace(id, f.path) : null;
}
export const allTasks = () => [...workspaces.values()].flatMap(w => w.tasks);
export const findTask = id => allTasks().find(t => t.id === id);
export const outDir = t => t.outputDir || taskDir(t.id);
export const contextOf = t => wsOfTask.get(t.id).store.get(`context:${t.id}`) || {supplied: []};
export const saveContext = (t, ctx) => wsOfTask.get(t.id).store.put(`context:${t.id}`, ctx);

export function saveDocument(ws, {html, text}) {
  ws.document = {html, text: typeof text === 'string' ? text : htmlToText(html), revision: ws.document.revision + 1};
  ws.store.put('document', ws.document);
  return ws.document;
}
export function saveBrief(ws, brief) { ws.brief = String(brief || '').slice(0, 4000); ws.store.put('brief', ws.brief); }
export function savePackages(ws, sources) { ws.packages = sources; ws.store.put('packages', ws.packages); }

// The README of a project folder, if it has one: part of what the worker learns about the project.
export function readmeOf(ws) {
  if (!ws.folder) return '';
  for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
    try { return fs.readFileSync(path.join(ws.folder, name), 'utf8'); } catch {}
  }
  return '';
}
