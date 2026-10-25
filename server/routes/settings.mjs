// Settings (config.json) and the bits of app state the interface changes: the kind used last, onboarding.
import express from 'express';
import {jsonSchema, publicConfig, updateConfig} from '../config.mjs';
import * as host from '../runtime.mjs';
import {state, saveState} from '../workspaces.mjs';
import {broadcast} from '../live.mjs';
import {dropIdleSessions, pump} from '../worker.mjs';
import {fail} from './common.mjs';

const router = express.Router();

// Settings that change how sessions are built; idle sessions are rebuilt with the new values.
const SESSION_KEYS = ['userSkills', 'reasoning', 'mcpServers'];

router.put('/settings', (q, r) => {
  const {lastKind, onboarded, ...patch} = q.body || {};
  if (lastKind !== undefined) {
    if (typeof lastKind !== 'string' || !/^[a-z0-9-]+$/.test(lastKind)) return r.status(400).json({error: 'Unknown kind.'});
    state.lastKind = lastKind;
  }
  if (onboarded !== undefined) state.onboarded = !!onboarded;
  saveState();
  if (patch.defaultModel !== undefined) {
    try {
      host.resolveModel(patch.defaultModel);
    } catch (e) {
      return fail(r, 400, e);
    }
  }
  // Secrets left empty in the form mean "keep the one I have"; null clears it.
  if (patch.search) {
    for (const k of ['braveApiKey', 'tavilyApiKey']) {
      if (patch.search[k] === '' || patch.search[k] === true) delete patch.search[k];
      else if (patch.search[k] === null) patch.search[k] = '';
    }
  }
  const error = updateConfig(patch);
  if (error) return r.status(400).json({error});
  if (SESSION_KEYS.some(k => k in patch)) dropIdleSessions();
  broadcast();
  pump();
  r.json({...publicConfig(), lastKind: state.lastKind});
});

router.get('/settings/schema', (q, r) => r.json(jsonSchema()));

export default router;
