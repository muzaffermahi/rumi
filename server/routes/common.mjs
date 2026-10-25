// Helpers shared by the routes: error replies, looking up the workspace or task a URL names, and model housekeeping.
import * as host from '../runtime.mjs';
import {config, saveConfig} from '../config.mjs';
import {findTask, workspaceById} from '../workspaces.mjs';
import {broadcast} from '../live.mjs';
import {dropIdleSessions} from '../worker.mjs';

export const fail = (r, status, e) => r.status(status).json({error: e?.message || String(e)});
export const wsParam = (q, r) => {
  const ws = workspaceById(q.params.wid);
  if (!ws) r.status(404).json({error: 'That workspace is no longer available.'});
  return ws;
};
export const taskParam = (q, r) => {
  const t = findTask(q.params.id);
  if (!t) r.status(404).json({error: 'That task no longer exists.'});
  return t;
};
// Wraps an async handler so a thrown error becomes a 400 with its message.
export const handle = fn => async (q, r) => {
  try {
    await fn(q, r);
  } catch (e) {
    if (!r.headersSent) fail(r, e.status || 400, e);
  }
};

// Ready means at least one model is connected and the default model is one of them.
export const ready = () => {
  const m = host.knownModels();
  return m.length > 0 && m.some(x => x.ref === config.defaultModel);
};

// When the user has several: a subscription they already pay for before pay-per-use keys, a capable model
// before a small one, hosted before local.
export function preferredModel(models) {
  const flat = m => host.runtime.isUsingSubscription(m.provider) || m.provider === 'opencode-go';
  const rank = m => (flat(m) ? 0 : 4) + (/opus|sonnet|gpt-5|grok-4|gemini-2\.5-pro|gemini-3|kimi-k2|glm-5|deepseek/i.test(m.id) ? 0 : 1) + (m.local ? 2 : 0);
  return [...models].sort((a, b) => rank(a) - rank(b))[0].ref;
}

// After connecting something: pick a default model if there is none yet, and tell every page.
export async function modelsChanged() {
  const models = await host.listModels();
  host.protectSignIns();
  if (models.length && !models.some(m => m.ref === config.defaultModel)) {
    config.defaultModel = preferredModel(models);
    saveConfig();
  }
  dropIdleSessions();
  broadcast();
}

// First start with models already available (environment keys, shared Pi sign-ins): choose a default right away.
// Called once the model list has loaded.
export function chooseDefaultModel() {
  if (config.defaultModel || !host.knownModels().length) return;
  config.defaultModel = host.fallbackModel || preferredModel(host.knownModels());
  saveConfig();
}
