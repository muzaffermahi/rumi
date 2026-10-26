// Connecting models without a terminal: subscription sign-ins and API keys go through Pi's own login flows,
// with their prompts and links shown in the browser; local servers (LM Studio, Ollama) are detected.
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as host from './runtime.mjs';

// API keys first, then the subscriptions that may be used from other apps (ChatGPT, Copilot…), then local models.
// Claude subscriptions are not offered: Anthropic's terms keep them to Claude Code and Claude.ai (see runtime.mjs);
// Claude is available here with an Anthropic API key. Anything already connected is shown too.
const SUBSCRIPTIONS = ['openai', 'github-copilot', 'xai', 'kimi-coding', 'openrouter', 'meta'];
const KEY_PROVIDERS = [
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'opencode-go',
  'opencode',
  'xai',
  'deepseek',
  'groq',
  'mistral',
  'moonshotai',
  'zai',
  'minimax',
  'together',
  'fireworks',
  'cerebras',
  'huggingface',
  'nvidia',
];

export async function status() {
  const rt = host.runtime;
  const stored = new Set((await rt.listCredentials().catch(() => [])).map(c => c.providerId));
  const models = await host.listModels();
  const describe = p => ({
    id: p.id,
    name: p.name,
    oauth: p.auth?.oauth
      ? {name: p.auth.oauth.name, label: p.auth.oauth.loginLabel || `Sign in with ${p.name}`, subscription: !!p.auth.oauth.isSubscription}
      : null,
    apiKey: p.auth?.apiKey?.login ? p.auth.apiKey.name : null,
    connected: models.some(m => m.provider === p.id),
    stored: stored.has(p.id),
    // Signed in with a subscription Rumi may not use (see runtime.mjs): shown with a note, its models left out.
    note: host.blockedSubscription(p.id) ? host.SUBSCRIPTION_NOTE : null,
    models: models.filter(m => m.provider === p.id).length,
  });
  const all = rt.getProviders().map(describe);
  const byId = new Map(all.map(p => [p.id, p]));
  return {
    mode: host.connections.mode,
    piInstalled: host.piInstalled(),
    piHome: host.userPiDir,
    subscriptions: SUBSCRIPTIONS.map(id => byId.get(id)).filter(p => p?.oauth),
    keys: KEY_PROVIDERS.map(id => byId.get(id)).filter(p => p?.apiKey),
    connected: all.filter(p => p.connected || p.note),
    local: await host.detectLocal(),
    models,
  };
}

// --- login flows ---
const logins = new Map();
const deviceFile = path.join(host.piDir, 'device-id');
const deviceId = () => {
  try {
    return fs.readFileSync(deviceFile, 'utf8').trim();
  } catch {}
  const id = randomUUID();
  fs.writeFileSync(deviceFile, id);
  return id;
};
const view = L => ({id: L.id, provider: L.provider, type: L.type, state: L.state, events: L.events, prompt: L.prompt, error: L.error});

export function startLogin(provider, type, onDone) {
  if (!host.runtime.getProvider(provider)) throw Error(`Unknown provider ${provider}.`);
  if (!['oauth', 'api_key'].includes(type)) throw Error('Unknown sign-in type.');
  if (type === 'oauth' && host.SUBSCRIPTION_NOT_ALLOWED.has(provider)) throw Error(host.SUBSCRIPTION_NOTE);
  for (const L of logins.values()) if (L.state === 'running') L.cancel();
  const controller = new AbortController();
  const L = {id: randomUUID(), provider, type, state: 'running', events: [], prompt: null, error: null, waiting: null, cancel: () => controller.abort()};
  const interaction = {
    signal: controller.signal,
    prompt: p =>
      new Promise((resolve, reject) => {
        const id = randomUUID();
        L.prompt = {id, type: p.type, message: p.message, placeholder: p.placeholder, options: p.options};
        L.waiting = {id, resolve, reject};
        const drop = () => {
          if (L.waiting?.id !== id) return;
          L.prompt = null;
          L.waiting = null;
          reject(Error('Cancelled'));
        };
        p.signal?.addEventListener('abort', drop, {once: true});
        controller.signal.addEventListener('abort', drop, {once: true});
      }),
    notify: e => {
      L.events = [...L.events, e].slice(-8);
    },
  };
  host.runtime
    .login(provider, type, interaction, {getDeviceId: deviceId})
    .then(async () => {
      L.state = 'done';
      await onDone?.();
    })
    .catch(e => {
      L.state = controller.signal.aborted ? 'cancelled' : 'failed';
      L.error = e.message;
    })
    .finally(() => {
      L.prompt = null;
      L.waiting = null;
    });
  logins.set(L.id, L);
  return view(L);
}

const loginOf = id => {
  const L = logins.get(id);
  if (!L) throw Error('That sign-in is no longer running.');
  return L;
};
export const getLogin = id => view(loginOf(id));
export function answerLogin(id, promptId, value) {
  const L = loginOf(id);
  if (!L.waiting || L.waiting.id !== promptId) throw Error('That step is no longer waiting for an answer.');
  const {resolve} = L.waiting;
  L.prompt = null;
  L.waiting = null;
  resolve(String(value ?? ''));
  return view(L);
}
export function cancelLogin(id) {
  const L = loginOf(id);
  L.cancel();
  return view(L);
}

export async function logout(provider) {
  await host.runtime.logout(provider);
  await host.listModels();
}
