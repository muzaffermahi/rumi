// Documents: a workspace's list of them, each one's text, its earlier versions, import and export, and pasted images.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {
  Conflict,
  createDocument,
  deleteDocument,
  docMeta,
  docOf,
  historyEntry,
  historyOf,
  restore,
  saveDocument,
  snapshot,
  updateDocumentMeta,
  wordCount,
} from '../workspaces.mjs';
import {exportDocument, importDocument} from '../documents.mjs';
import {broadcast, touch} from '../live.mjs';
import {stop} from '../worker.mjs';
import {fail, handle, wsParam} from './common.mjs';

const router = express.Router();

const docParam = (q, r) => {
  const ws = wsParam(q, r);
  if (!ws) return {};
  if (!docMeta(ws, q.params.did)) {
    r.status(404).json({error: 'That document no longer exists.'});
    return {};
  }
  return {ws, meta: docMeta(ws, q.params.did)};
};

router.get('/w/:wid/docs', (q, r) => {
  const ws = wsParam(q, r);
  if (ws) r.json(ws.docs);
});

router.post('/w/:wid/docs', (q, r) => {
  const ws = wsParam(q, r);
  if (!ws) return;
  const meta = createDocument(ws, {title: q.body?.title, html: typeof q.body?.html === 'string' ? q.body.html : ''});
  broadcast();
  r.json(meta);
});

router.post(
  '/w/:wid/docs/import',
  handle((q, r) => {
    const ws = wsParam(q, r);
    if (!ws) return;
    if (typeof q.body?.content !== 'string') return r.status(400).json({error: 'Nothing to import.'});
    const {title, html} = importDocument({name: String(q.body.name || ''), content: q.body.content});
    const meta = createDocument(ws, {title, html});
    broadcast();
    r.json(meta);
  }),
);

router.get('/w/:wid/docs/:did', (q, r) => {
  const {ws, meta} = docParam(q, r);
  if (!ws) return;
  const doc = docOf(ws, meta.id);
  r.json({...meta, ...doc, words: wordCount(doc.text)});
});

router.put('/w/:wid/docs/:did', (q, r) => {
  const {ws, meta} = docParam(q, r);
  if (!ws) return;
  if (typeof q.body?.html !== 'string') return r.status(400).json({error: 'The document is missing.'});
  try {
    const doc = saveDocument(ws, meta.id, {html: q.body.html, text: q.body.text, baseRevision: q.body.baseRevision, force: !!q.body.force});
    broadcast();
    r.json({revision: doc.revision, title: meta.title});
  } catch (e) {
    if (e instanceof Conflict) return r.status(409).json({error: e.message, conflict: true, ...docOf(ws, meta.id)});
    fail(r, 400, e);
  }
});

router.patch(
  '/w/:wid/docs/:did',
  handle((q, r) => {
    const {ws, meta} = docParam(q, r);
    if (!ws) return;
    const d = updateDocumentMeta(ws, meta.id, {title: q.body?.title, archived: q.body?.archived});
    broadcast();
    r.json(d);
  }),
);

// Deleting a document also stops and archives its tasks; their conversations stay readable.
router.delete(
  '/w/:wid/docs/:did',
  handle(async (q, r) => {
    const {ws, meta} = docParam(q, r);
    if (!ws) return;
    for (const t of ws.tasks.filter(t => t.docId === meta.id)) {
      if (['running', 'queued'].includes(t.status)) await stop(t);
      t.archived = true;
      touch(t);
    }
    deleteDocument(ws, meta.id);
    broadcast();
    r.json({ok: true});
  }),
);

router.get('/w/:wid/docs/:did/history', (q, r) => {
  const {ws, meta} = docParam(q, r);
  if (ws) r.json(historyOf(ws, meta.id));
});
router.get(
  '/w/:wid/docs/:did/history/:index',
  handle((q, r) => {
    const {ws, meta} = docParam(q, r);
    if (ws) r.json(historyEntry(ws, meta.id, Number(q.params.index)));
  }),
);
router.post(
  '/w/:wid/docs/:did/restore',
  handle((q, r) => {
    const {ws, meta} = docParam(q, r);
    if (!ws) return;
    const doc = restore(ws, meta.id, Number(q.body?.index));
    broadcast();
    r.json({...meta, ...doc});
  }),
);
router.post(
  '/w/:wid/docs/:did/snapshot',
  handle((q, r) => {
    const {ws, meta} = docParam(q, r);
    if (!ws) return;
    const entry = snapshot(ws, meta.id, String(q.body?.label || 'Saved version').slice(0, 120));
    r.json({rev: entry.rev, at: entry.at, label: entry.label, words: entry.words});
  }),
);

router.get(
  '/w/:wid/docs/:did/export',
  handle((q, r) => {
    const {ws, meta} = docParam(q, r);
    if (!ws) return;
    const file = exportDocument({title: meta.title, ...docOf(ws, meta.id)}, String(q.query.format || 'md'));
    r.set('Content-Type', file.type);
    if (q.query.download !== undefined) r.attachment(file.name);
    r.send(file.body);
  }),
);

// --- images pasted or dropped into a document, kept in the workspace's data folder ---
const IMAGE_TYPES = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp'};
const assetsDir = ws => path.join(ws.store.dir, 'assets');

router.post(
  '/w/:wid/assets',
  handle((q, r) => {
    const ws = wsParam(q, r);
    if (!ws) return;
    const ext = IMAGE_TYPES[q.body?.type];
    if (!ext) return r.status(400).json({error: 'Only PNG, JPEG, GIF and WebP images can be added.'});
    const data = Buffer.from(String(q.body.data || ''), 'base64');
    if (!data.length || data.length > 15 * 1024 * 1024) return r.status(400).json({error: 'Images can be up to 15 MB.'});
    fs.mkdirSync(assetsDir(ws), {recursive: true});
    const name = `${randomUUID().slice(0, 12)}.${ext}`;
    fs.writeFileSync(path.join(assetsDir(ws), name), data);
    r.json({url: `/api/w/${ws.id}/assets/${name}`});
  }),
);

router.get('/w/:wid/assets/:name', (q, r) => {
  const ws = wsParam(q, r);
  if (!ws) return;
  const name = q.params.name;
  if (!/^[\w-]+\.(png|jpg|gif|webp)$/.test(name) || !fs.existsSync(path.join(assetsDir(ws), name))) return r.sendStatus(404);
  r.set({'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'private, max-age=31536000, immutable'});
  r.sendFile(path.join(assetsDir(ws), name));
});

export default router;
