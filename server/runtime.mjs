// Rumi's Pi host. Rumi embeds the Pi SDK, so it works without Pi installed, and keeps its own Pi home
// (<data>/pi) so it never changes or loads the user's Pi setup. The one thing it can share with Pi is
// sign-ins: in "pi" mode it uses Pi's auth.json and models.json, so a subscription connected in either
// app works in both.
import {
  createAgentSession,
  createMcpExtension,
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rumiWorker} from '../pi/extension.mjs';
import {WORKER_PROMPT} from '../pi/prompt.mjs';
import {kindOf, toolsFor} from '../pi/kinds.mjs';
import {appDir, dataDir, piDir, readJson} from './paths.mjs';
import {config} from './config.mjs';

export {appDir};
export const root = dataDir;
export {piDir};
fs.mkdirSync(piDir, {recursive: true});
export const userPiDir = getAgentDir();
export const rumiSkills = path.join(appDir, 'pi', 'skills');
export const taskDir = id => path.join(dataDir, 'outputs', id);
export const fallbackModel = process.env.PI_PROVIDER && process.env.PI_MODEL ? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}` : '';

// --- connections: where sign-ins live, and local model servers Rumi added ---
const connectionsFile = path.join(piDir, 'connections.json');
export const piInstalled = () => ['auth.json', 'models.json', 'settings.json'].some(f => fs.existsSync(path.join(userPiDir, f)));
export const connections = {mode: piInstalled() ? 'pi' : 'rumi', local: [], ...readJson(connectionsFile, {})};
const saveConnections = () => fs.writeFileSync(connectionsFile, JSON.stringify(connections, null, 1));
if (!fs.existsSync(connectionsFile)) saveConnections();

const homeFor = mode => (mode === 'pi' ? userPiDir : piDir);
export const authFile = () => path.join(homeFor(connections.mode), 'auth.json');
export let runtime = null;
let available = [];

export async function loadRuntime() {
  const home = homeFor(connections.mode);
  runtime = await ModelRuntime.create({
    authPath: path.join(home, 'auth.json'),
    modelsPath: path.join(home, 'models.json'),
    modelsStorePath: path.join(piDir, 'models-store.json'),
  });
  for (const l of connections.local) registerLocal(l);
  await listModels();
  protectSignIns();
  return runtime;
}

// Sign-in files hold tokens: keep them readable only by you (on Windows the profile folder is already private).
export function protectSignIns() {
  if (process.platform === 'win32') return;
  try {
    if (fs.existsSync(authFile()) && fs.statSync(authFile()).mode & 0o077) fs.chmodSync(authFile(), 0o600);
  } catch {}
}

// Switches between Rumi's own sign-ins and the ones shared with Pi.
export async function setConnectionMode(mode) {
  if (!['pi', 'rumi'].includes(mode)) throw Error('Unknown connection mode.');
  connections.mode = mode;
  saveConnections();
  await loadRuntime();
}

// --- local servers (LM Studio, Ollama, and any OpenAI-compatible server you add) ---
export const LOCAL_SERVERS = [
  {id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'lmstudio'},
  {id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama'},
];
function registerLocal(l) {
  // A provider Pi already defines (for example in the user's models.json) is left alone.
  if (runtime.getProvider(l.id) && !runtime.getRegisteredProviderIds().includes(l.id)) return;
  runtime.registerProvider(l.id, {
    name: l.name,
    baseUrl: l.baseUrl,
    api: 'openai-completions',
    apiKey: l.apiKey,
    // Local models are free; Pi needs a cost to total usage when the server reports tokens.
    models: l.models.map(id => ({
      id,
      name: id,
      input: ['text'],
      contextWindow: l.contextWindow || 32768,
      maxTokens: 8192,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    })),
  });
}
// Which local servers are running, and their models. added: Rumi connected it (so Rumi can remove it);
// connected: Pi knows it either way (for example from the user's own models.json).
const state = s => ({
  added: connections.local.some(l => l.id === s.id),
  connected: connections.local.some(l => l.id === s.id) || !!runtime.getModels(s.id).length,
});
const servers = () => [...LOCAL_SERVERS, ...connections.local.filter(l => !LOCAL_SERVERS.some(s => s.id === l.id))];
export async function detectLocal() {
  return Promise.all(
    servers().map(async s => {
      try {
        const r = await fetch(`${s.baseUrl}/models`, {signal: AbortSignal.timeout(1500), headers: s.apiKey ? {Authorization: `Bearer ${s.apiKey}`} : {}});
        const ids = r.ok ? ((await r.json()).data || []).map(m => m.id).filter(id => !/embed/i.test(id)) : [];
        return {id: s.id, name: s.name, baseUrl: s.baseUrl, running: r.ok, models: ids, ...state(s)};
      } catch {
        return {id: s.id, name: s.name, baseUrl: s.baseUrl, running: false, models: [], ...state(s)};
      }
    }),
  );
}
export async function connectLocal(id, custom) {
  if (custom) {
    if (!/^[a-z0-9-]+$/.test(custom.id || '')) throw Error('Give the server a short id: lowercase letters, digits and -.');
    if (!/^https?:\/\//.test(custom.baseUrl || '')) throw Error('The address should start with http:// or https://, for example http://127.0.0.1:8080/v1.');
    const entry = {id: custom.id, name: custom.name || custom.id, baseUrl: custom.baseUrl.replace(/\/+$/, ''), apiKey: custom.apiKey || 'none', models: []};
    connections.local = [...connections.local.filter(l => l.id !== entry.id), entry];
    id = entry.id;
  }
  const s = (await detectLocal()).find(x => x.id === id);
  if (!s?.running) throw Error(`${s?.name || id} is not running on this computer.`);
  if (!s.models.length) throw Error(`${s.name} has no models loaded. Download or load one in ${s.name}, then try again.`);
  const known = servers().find(x => x.id === id);
  const entry = {id: s.id, name: s.name, baseUrl: s.baseUrl, apiKey: known.apiKey, models: s.models};
  connections.local = [...connections.local.filter(l => l.id !== id), entry];
  saveConnections();
  registerLocal(entry);
  await listModels();
}
export async function forgetLocal(id) {
  connections.local = connections.local.filter(l => l.id !== id);
  saveConnections();
  await loadRuntime();
}

// --- models ---
const describeModel = m => ({
  ref: `${m.provider}/${m.id}`,
  provider: m.provider,
  id: m.id,
  name: m.name,
  contextWindow: m.contextWindow,
  reasoning: !!m.reasoning,
  local: connections.local.some(l => l.id === m.provider),
  subscription: !!runtime?.isUsingSubscription?.(m.provider),
});
// Providers whose subscription sign-in may not be used by other apps. Anthropic's terms allow Claude Free, Pro and
// Max credentials only in Claude Code and Claude.ai (https://code.claude.com/docs/en/legal-and-compliance), so Rumi
// uses Claude only through an API key, even when a Claude subscription is signed in through shared Pi sign-ins.
export const SUBSCRIPTION_NOT_ALLOWED = new Set(['anthropic']);
export const blockedSubscription = provider => SUBSCRIPTION_NOT_ALLOWED.has(provider) && !!runtime?.isUsingSubscription?.(provider);
export const SUBSCRIPTION_NOTE =
  "Anthropic's terms allow Claude subscriptions only in Claude Code and Claude.ai, so Rumi can't use one. Add an Anthropic API key in Settings → Models to use Claude here.";

export async function listModels() {
  try {
    available = (await runtime.getAvailable()).filter(m => !blockedSubscription(m.provider));
  } catch (e) {
    console.error('Model listing failed:', e.message);
  }
  return available.map(describeModel);
}
// The models from the last listing, without asking providers again.
export const knownModels = () => available.map(describeModel);
// Returns the Pi model for "provider/id", or throws a message the user can act on. Never substitutes.
export function resolveModel(ref) {
  if (!ref) throw Error('No model selected. Connect a model in Settings → Models.');
  const i = ref.indexOf('/');
  if (i < 1) throw Error(`Model "${ref}" should look like provider/model.`);
  const provider = ref.slice(0, i),
    id = ref.slice(i + 1),
    model = runtime.getModel(provider, id);
  if (!model) throw Error(`Model ${ref} is not known. Check Settings → Models.`);
  if (blockedSubscription(provider)) throw Error(SUBSCRIPTION_NOTE);
  if (available.length && !available.some(m => m.provider === provider && m.id === id))
    throw Error(`Model ${ref} is not connected. Sign in to ${provider} in Settings → Models.`);
  return model;
}

// --- Pi packages ---
// Rumi installs packages into its own Pi home (never the user's Pi). Which ones a task loads is decided per workspace.
const packageManager = () => new DefaultPackageManager({cwd: piDir, agentDir: piDir, settingsManager: SettingsManager.inMemory({})});
export const packageSource = name => (name.startsWith('npm:') || name.startsWith('git:') || /^https?:/.test(name) ? name : `npm:${name.trim()}`);
// ignoreScripts: install without running the package's install scripts (safer; a few packages need them).
export async function installPackage(source, {ignoreScripts = false} = {}) {
  const pm = packageManager();
  const before = process.env.npm_config_ignore_scripts;
  if (ignoreScripts) process.env.npm_config_ignore_scripts = 'true';
  try {
    await pm.install(source);
  } finally {
    if (before === undefined) delete process.env.npm_config_ignore_scripts;
    else process.env.npm_config_ignore_scripts = before;
  }
  const dir = pm.getInstalledPath(source, 'user');
  const pkg = readJson(path.join(dir || '', 'package.json'), {});
  return {source, name: pkg.name || source.replace(/^npm:/, ''), version: pkg.version || '', description: pkg.description || '', path: dir};
}
export async function removePackage(source) {
  await packageManager().remove(source);
}

// Packages the user installed in their own Pi: suggestions Rumi can install a copy of.
export function piPackages() {
  const settings = readJson(path.join(userPiDir, 'settings.json'), {});
  const out = [];
  for (const source of settings.packages || []) {
    const spec = typeof source === 'string' ? source : source.source;
    if (!spec?.startsWith('npm:')) continue;
    const name = spec.slice(4).replace(/(?!^)@[^/]*$/, '');
    const pkg = readJson(path.join(userPiDir, 'npm', 'node_modules', name, 'package.json'), null);
    if (pkg) out.push({source: `npm:${name}`, name, version: pkg.version, description: pkg.description || ''});
  }
  return out;
}

// Pi packages on npm (they carry the "pi-package" keyword), for the package browser.
export async function searchPackages(text = '') {
  const q = `keywords:pi-package ${String(text).trim()}`.trim();
  const r = await fetch(`https://registry.npmjs.org/-/v1/search?${new URLSearchParams({text: q, size: '30'})}`, {signal: AbortSignal.timeout(10000)});
  if (!r.ok) throw Error(`npm search failed (HTTP ${r.status}).`);
  return ((await r.json()).objects || []).map(o => ({
    source: `npm:${o.package.name}`,
    name: o.package.name,
    version: o.package.version,
    description: o.package.description || '',
    keywords: o.package.keywords || [],
    publisher: o.package.publisher?.username || '',
    updated: o.package.date,
    links: o.package.links || {},
    downloads: o.downloads?.monthly ?? null,
  }));
}

const under = (file, dir) => {
  const rel = path.relative(dir, file);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

// MCP servers from config.json that a workspace turned on, as Pi's MCP extension expects them. Their tools are
// declared to the model directly, so the worker sees them like its other tools.
function mcpEntries(names) {
  return names
    .filter(n => config.mcpServers[n])
    .map(name => ({name, config: {...config.mcpServers[name], exposure: 'direct', enabled: true}, source: path.join(dataDir, 'config.json'), scope: 'global'}));
}

// --- sessions ---
// One Pi session per task. ctl is the task's live control object (see pi/extension.mjs); folder is the project folder
// the worker works in (the workspace's, or a worktree of it); packages are the opted-in Pi packages; mcp the opted-in
// MCP servers' names.
export async function makeSession({
  ctl,
  sessionFile,
  modelRef,
  kind,
  folder,
  skillFolder = folder,
  outDir,
  sessionsDir,
  packages = [],
  mcp = [],
  userSkills = false,
  reasoning = 'auto',
  uiContext,
}) {
  fs.mkdirSync(outDir, {recursive: true});
  const cwd = folder || outDir;
  const model = resolveModel(modelRef);
  const settingsManager = SettingsManager.inMemory({
    compaction: {enabled: true},
    // RUMI_MODEL_RETRIES lets tests fail fast; people get four retries with backoff.
    retry: {enabled: true, maxRetries: Number(process.env.RUMI_MODEL_RETRIES ?? 4), baseDelayMs: 2000, maxAgentDelayMs: 60000},
    packages,
    extensions: [],
    skills: [],
  });
  // Skills: Rumi's own, the opted-in packages', the project's, and the user's personal ones only when they ask.
  // Pi also discovers ~/.agents/skills by itself, so skills from anywhere else are filtered out.
  const skillRoots = [
    rumiSkills,
    piDir,
    ...(skillFolder ? [skillFolder, folder] : []),
    ...(userSkills ? [path.join(os.homedir(), '.agents', 'skills'), userPiDir] : []),
  ].filter(Boolean);
  const skillPaths = [
    rumiSkills,
    ...(skillFolder ? [path.join(skillFolder, '.agents', 'skills'), path.join(skillFolder, '.pi', 'skills')] : []),
    ...(userSkills ? [path.join(os.homedir(), '.agents', 'skills')] : []),
  ];
  const servers = mcpEntries(mcp);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: piDir,
    settingsManager,
    extensionFactories: [
      rumiWorker(ctl),
      ...(servers.length
        ? [createMcpExtension({loadConfig: () => ({servers, errors: [], autoEnableCodemode: false}), logPath: path.join(piDir, 'mcp.log')})]
        : []),
    ],
    additionalSkillPaths: skillPaths.filter(p => fs.existsSync(p)),
    noContextFiles: !folder, // a project's AGENTS.md; task folders have none worth reading
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: WORKER_PROMPT,
    skillsOverride: base => ({...base, skills: base.skills.filter(s => skillRoots.some(r => under(s.filePath, r)))}),
  });
  await loader.reload();
  // The kind decides Pi's built-in tools; tools from opted-in packages and MCP servers come on top.
  const own = new Set(toolsFor('build'));
  const packageTools = loader
    .getExtensions()
    .extensions.flatMap(e => [...(e.tools?.keys?.() || [])])
    .filter(n => !own.has(n) && !n.startsWith('mcp__'));
  const {session, extensionsResult} = await createAgentSession({
    cwd,
    agentDir: piDir,
    model,
    modelRuntime: runtime,
    resourceLoader: loader,
    settingsManager,
    thinkingLevel: reasoning === 'off' ? 'off' : kindOf(kind, skillFolder).thinking,
    tools: [...toolsFor(kind, skillFolder), ...packageTools, ...servers.map(s => `mcp__${s.name.replace(/[^A-Za-z0-9_]/g, '_')}__*`)],
    sessionManager: sessionFile ? SessionManager.open(sessionFile) : SessionManager.create(cwd, sessionsDir),
  });
  if (session.model && `${session.model.provider}/${session.model.id}` !== modelRef) {
    session.dispose();
    throw Error(`Pi opened ${session.model.provider}/${session.model.id} instead of ${modelRef}; refusing to substitute.`);
  }
  await session.bindExtensions({uiContext, mode: 'rpc', onError: e => console.error(`Extension ${e.extensionPath}: ${e.error}`)});
  const errors = extensionsResult.errors.map(e => `${path.basename(e.path)}: ${e.error}`);
  return {session, errors};
}
