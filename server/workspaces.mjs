// Workspaces: the Global one and one per project folder, each with its own documents and tasks.
// App-wide state (recent folders, the kind used last, onboarding) lives in the Global workspace's store;
// settings live in config.json (config.mjs).
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dataDir} from './paths.mjs';
import {config, adoptLegacySettings} from './config.mjs';
import {titleFrom} from './context.mjs';
import {htmlToText} from './text.mjs';
import {throttle} from './queue.mjs';
import {describeFolder} from './folders.mjs';
import {GLOBAL, openStore, workspaceId, projectDataDir} from './store.mjs';
import {legacyKind} from '../pi/kinds.mjs';
import {WELCOME_HTML, WELCOME_TITLE} from './welcome.mjs';

export {GLOBAL};
export const SCHEMA_VERSION = 5;

// The global workspace is the original data/ folder (earlier data stays where it was).
export const globalStore = openStore(dataDir);
const meta = globalStore.get('meta');
if (!globalStore.fresh && (meta?.version || 1) < SCHEMA_VERSION) backup(globalStore, `rumi-v${meta?.version || 1}`);
globalStore.put('meta', {version: SCHEMA_VERSION});

// Before a schema change: a copy of the database, so nothing is lost if a migration goes wrong.
function backup(store, label) {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${label}-${Date.now()}.sqlite`);
  store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log('Backed up data to', file);
}

// v4 and earlier kept settings in the store; they now live in config.json.
const legacy = globalStore.get('settings');
if (adoptLegacySettings(legacy)) console.log('Moved settings to config.json');

export const state = {
  recentFolders: legacy?.recentFolders || [],
  lastKind: legacy?.lastKind || 'research',
  onboarded: !!legacy?.defaultModel,
  ...globalStore.get('state'),
};
export const saveState = () => globalStore.put('state', state);
saveState();

// Live-only task fields, never written to disk.
export const TRANSIENT = ['live', 'liveOpen', 'activeTool', 'steering', 'activity', 'timedOut', 'stalled', 'dialog', 'notice'];
const HISTORY_MAX = 100;
const SNAPSHOT_EVERY = 10 * 60_000;

export const workspaces = new Map();
export const wsOfTask = new Map();

export function loadWorkspace(id, folder) {
  if (workspaces.has(id)) return workspaces.get(id);
  const store = folder ? openStore(projectDataDir(folder), {project: true}) : globalStore;
  const info = folder ? describeFolder(folder) : null;
  const ws = {
    id,
    folder: folder || null,
    name: info?.name || 'Global',
    isRepo: !!info?.isRepo,
    store,
    tasks: store.get('tasks') || [],
    packages: store.get('packages') || [],
    mcp: store.get('mcp') || [],
    docs: store.get('docs') || [],
  };
  ws.persist = throttle(
    () =>
      store.put(
        'tasks',
        ws.tasks.map(t => Object.fromEntries(Object.entries(t).filter(([k]) => !TRANSIENT.includes(k)))),
      ),
    2000,
  );
  ws.hasReadme = !!readmeOf(ws);
  migrateDocuments(ws);
  for (const t of ws.tasks) {
    migrate(t, store, ws);
    wsOfTask.set(t.id, ws);
  }
  store.put('tasks', ws.tasks);
  workspaces.set(id, ws);
  return ws;
}

// v4 and earlier: one document per workspace, under 'document'. It becomes the first of the workspace's documents.
function migrateDocuments(ws) {
  if (ws.store.get('docs')) return;
  const old = ws.store.get('document');
  if (old?.html || old?.text) {
    const text = old.text ?? htmlToText(old.html);
    const doc = {
      id: 'main',
      title: titleFrom(text.split('\n').find(l => l.trim()) || 'Notes', 48),
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      archived: false,
    };
    ws.store.put('doc:main', {html: old.html || '', text, revision: old.revision || 0});
    ws.docs = [doc];
  } else ws.docs = [];
  ws.store.put('docs', ws.docs);
}

function migrate(t, store, ws) {
  // Additive only: fields from earlier versions are kept.
  t.title ??= titleFrom(t.context?.instruction || t.source || t.objective);
  t.pending ??= [];
  t.started ??= !!t.sessionFile;
  t.model ??= modelFromSession(t.sessionFile) || config.defaultModel;
  t.files ??= [];
  t.kind ??= legacyKind(t);
  t.docId ??= ws.docs[0]?.id || null;
  t.usage ??= null;
  if (!store.get(`context:${t.id}`) && t.context?.background)
    store.put(`context:${t.id}`, {
      supplied: [
        {
          at: t.created,
          kind: 'delegation',
          revision: t.context.documentRevision,
          shortened: true,
          text: t.context.background,
          note: 'v1 sent the first 6,000 characters of the document.',
        },
      ],
    });
  if (['running', 'queued'].includes(t.status)) {
    t.status = 'interrupted';
    t.error = 'Rumi restarted. Send a message or resume to continue.';
  }
  for (const k of TRANSIENT) delete t[k];
}
function modelFromSession(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const e = JSON.parse(line);
      if (e.type === 'model_change') return `${e.provider}/${e.modelId}`;
    }
  } catch {}
  return null;
}

export const wsInfo = ws => ({
  id: ws.id,
  name: ws.name,
  path: ws.folder,
  isRepo: ws.isRepo,
  packages: ws.packages,
  mcp: ws.mcp,
  readme: ws.hasReadme,
  docs: ws.docs,
});
export const workspaceList = () => [
  {id: GLOBAL, name: 'Global', path: null, isRepo: false},
  ...(state.recentFolders || []).map(f => ({id: workspaceId(f.path), name: f.name, path: f.path, isRepo: f.isRepo})),
];
export function workspaceById(id) {
  if (workspaces.has(id)) return workspaces.get(id);
  const f = (state.recentFolders || []).find(f => workspaceId(f.path) === id);
  return f && describeFolder(f.path).exists ? loadWorkspace(id, f.path) : null;
}
export const allTasks = () => [...workspaces.values()].flatMap(w => w.tasks);
export const findTask = id => allTasks().find(t => t.id === id);
export const outDir = t => t.outputDir || path.join(dataDir, 'outputs', t.id);
export const contextOf = t => wsOfTask.get(t.id).store.get(`context:${t.id}`) || {supplied: []};
export const saveContext = (t, ctx) => wsOfTask.get(t.id).store.put(`context:${t.id}`, ctx);

export function savePackages(ws, sources) {
  ws.packages = sources;
  ws.store.put('packages', ws.packages);
}
export function saveMcp(ws, names) {
  ws.mcp = names;
  ws.store.put('mcp', ws.mcp);
}

// --- documents ---
const saveIndex = ws => ws.store.put('docs', ws.docs);
export const docMeta = (ws, id) => ws.docs.find(d => d.id === id) || null;
export function docOf(ws, id) {
  if (!docMeta(ws, id)) return null;
  return ws.store.get(`doc:${id}`) || {html: '', text: '', revision: 0};
}

export function createDocument(ws, {title = 'Untitled', html = '', text} = {}) {
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const meta = {id, title: String(title).trim().slice(0, 120) || 'Untitled', created: now, updated: now, archived: false};
  ws.docs = [meta, ...ws.docs];
  ws.store.put(`doc:${id}`, {html, text: text ?? htmlToText(html), revision: 0});
  saveIndex(ws);
  return meta;
}

export function updateDocumentMeta(ws, id, {title, archived}) {
  const d = docMeta(ws, id);
  if (!d) throw Error('That document no longer exists.');
  if (title !== undefined) d.title = String(title).trim().slice(0, 120) || 'Untitled';
  if (archived !== undefined) d.archived = !!archived;
  saveIndex(ws);
  return d;
}

export function deleteDocument(ws, id) {
  if (!docMeta(ws, id)) throw Error('That document no longer exists.');
  ws.docs = ws.docs.filter(d => d.id !== id);
  saveIndex(ws);
  ws.store.del(`doc:${id}`);
  ws.store.del(`history:${id}`);
}

export class Conflict extends Error {}

// Saves a new version. baseRevision is the revision the editor started from; a different current revision
// means another tab saved in between, and the save is refused unless forced.
export function saveDocument(ws, id, {html, text, baseRevision, force = false}) {
  const d = docMeta(ws, id);
  if (!d) throw Error('That document no longer exists.');
  const cur = docOf(ws, id);
  if (!force && baseRevision !== undefined && baseRevision !== cur.revision) throw new Conflict('This document was changed in another tab or window.');
  const next = {html, text: typeof text === 'string' ? text : htmlToText(html), revision: cur.revision + 1};
  ws.store.put(`doc:${id}`, next);
  d.updated = new Date().toISOString();
  if (d.title === 'Untitled') {
    const first = next.text.split('\n').find(l => l.trim());
    if (first) d.title = titleFrom(first, 48);
  }
  saveIndex(ws);
  const history = ws.store.get(`history:${id}`) || [];
  if (!history.length || Date.now() - Date.parse(history.at(-1).at) > SNAPSHOT_EVERY) snapshot(ws, id, '');
  return next;
}

// A version you can go back to. Labelled ones are taken before Rumi changes the document for you.
export function snapshot(ws, id, label) {
  const cur = docOf(ws, id);
  if (!cur) throw Error('That document no longer exists.');
  const history = ws.store.get(`history:${id}`) || [];
  if (history.at(-1)?.html === cur.html && !label) return history.at(-1);
  const entry = {rev: cur.revision, at: new Date().toISOString(), label: String(label || ''), words: wordCount(cur.text), html: cur.html};
  ws.store.put(`history:${id}`, [...history, entry].slice(-HISTORY_MAX));
  return entry;
}
export const historyOf = (ws, id) => (ws.store.get(`history:${id}`) || []).map(({html, ...rest}, index) => ({index, ...rest})).reverse();
export function historyEntry(ws, id, index) {
  const e = (ws.store.get(`history:${id}`) || [])[index];
  if (!e) throw Error('That version is no longer kept.');
  return e;
}
export function restore(ws, id, index) {
  const e = historyEntry(ws, id, index);
  snapshot(ws, id, 'Before restoring an earlier version');
  return saveDocument(ws, id, {html: e.html, force: true});
}
export const wordCount = text => (String(text || '').match(/\S+/g) || []).length;

// The README of a project folder, if it has one: part of what the worker learns about the project.
export function readmeOf(ws) {
  if (!ws.folder) return '';
  for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
    try {
      return fs.readFileSync(path.join(ws.folder, name), 'utf8');
    } catch {}
  }
  return '';
}

// Opened last, once everything above exists. A new Rumi (or one just updated from 0.4) gets the welcome tour once.
const globalWs = loadWorkspace(GLOBAL, null);
if (!state.welcomed) {
  createDocument(globalWs, {title: WELCOME_TITLE, html: WELCOME_HTML});
  state.welcomed = true;
  saveState();
}
