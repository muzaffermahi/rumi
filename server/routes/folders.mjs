// Choosing a folder: the system picker, a pasted path, the in-browser browser, and the recent list.
import express from 'express';
import {canPick, describeFolder, listFolders, pickFolder} from '../folders.mjs';
import {saveState, state} from '../workspaces.mjs';
import {broadcast} from '../live.mjs';
import {fail} from './common.mjs';

const router = express.Router();

let picking = false;
router.post('/folders/pick', async (q, r) => {
  if (picking) return r.status(409).json({error: 'A folder picker is already open on your screen.'});
  picking = true;
  try {
    const chosen = await pickFolder(q.body?.start);
    r.json(chosen ? {folder: describeFolder(chosen)} : {cancelled: true});
  } catch (e) {
    fail(r, canPick ? 500 : 501, e);
  } finally {
    picking = false;
  }
});
router.get('/folders/list', (q, r) => {
  try {
    r.json({...listFolders(q.query.path), canPick});
  } catch (e) {
    fail(r, 400, e);
  }
});
router.post('/folders/check', (q, r) => {
  const f = describeFolder(q.body?.path);
  if (!f.exists) return r.status(400).json({error: `Folder not found: ${f.path || '(empty path)'}`});
  r.json({folder: f});
});
router.post('/folders/forget', (q, r) => {
  state.recentFolders = (state.recentFolders || []).filter(f => f.path !== q.body?.path);
  saveState();
  broadcast();
  r.json({recentFolders: state.recentFolders});
});

export default router;
