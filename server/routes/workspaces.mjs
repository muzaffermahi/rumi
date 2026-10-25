// Workspaces: opening a folder, and the Pi packages and MCP servers a workspace gives its tasks.
import express from 'express';
import {config} from '../config.mjs';
import {describeFolder, remember} from '../folders.mjs';
import {workspaceId} from '../store.mjs';
import {loadWorkspace, saveMcp, savePackages, saveState, state, workspaceList, wsInfo} from '../workspaces.mjs';
import {broadcast} from '../live.mjs';
import {dropIdleSessions} from '../worker.mjs';
import {fail, wsParam} from './common.mjs';

const router = express.Router();

router.get('/workspaces', (q, r) => r.json(workspaceList()));

// Opening a folder (from the switcher or the `rumi` command) creates <folder>/.rumi on first use.
router.post('/workspaces/open', (q, r) => {
  const f = describeFolder(q.body?.path);
  if (!f.exists) return r.status(400).json({error: `Folder not found: ${f.path || '(empty path)'}`});
  let ws;
  try {
    ws = loadWorkspace(workspaceId(f.path), f.path);
  } catch (e) {
    return fail(r, 500, Error(`Could not open ${f.path}: ${e.message}`));
  }
  state.recentFolders = remember(state.recentFolders, f);
  saveState();
  broadcast();
  r.json({workspace: wsInfo(ws)});
});

router.put('/w/:wid/packages', (q, r) => {
  const ws = wsParam(q, r);
  if (!ws) return;
  const installed = new Set(config.packages.map(p => p.source));
  savePackages(
    ws,
    (q.body?.sources || []).filter(s => installed.has(s)),
  );
  dropIdleSessions();
  broadcast();
  r.json(wsInfo(ws));
});

router.put('/w/:wid/mcp', (q, r) => {
  const ws = wsParam(q, r);
  if (!ws) return;
  saveMcp(
    ws,
    (q.body?.names || []).filter(n => config.mcpServers[n]),
  );
  dropIdleSessions();
  broadcast();
  r.json(wsInfo(ws));
});

export default router;
