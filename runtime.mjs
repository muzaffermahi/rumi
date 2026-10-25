// Rumi's Pi host. Rumi embeds the Pi SDK, so it works without Pi installed, and keeps its own Pi home
// (<data>/pi) so it never changes or loads the user's Pi setup. The one thing it can share with Pi is
// sign-ins: in "pi" mode it uses Pi's auth.json and models.json, so a subscription connected in either
// app works in both.
import {createAgentSession, DefaultPackageManager, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager} from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rumiWorker} from './pi/extension.mjs';
import {WORKER_PROMPT} from './pi/prompt.mjs';
import {KINDS, toolsFor} from './pi/kinds.mjs';

export const appDir = path.dirname(fileURLToPath(import.meta.url));
// A checkout that already has data/ keeps using it; an installed copy keeps its data in ~/.rumi.
export const root = path.resolve(process.env.RUMI_DATA || (fs.existsSync(path.join(appDir, 'data')) ? path.join(appDir, 'data') : path.join(os.homedir(), '.rumi')));
export const piDir = path.join(root, 'pi');
fs.mkdirSync(piDir, {recursive: true});
export const userPiDir = getAgentDir();
export const rumiSkills = path.join(appDir, 'pi', 'skills');
export const taskDir = id => path.join(root, 'outputs', id);
export const fallbackModel = process.env.PI_PROVIDER && process.env.PI_MODEL ? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}` : '';

// --- connections: where sign-ins live, and local model servers Rumi added ---
const connectionsFile = path.join(piDir, 'connections.json');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
export const piInstalled = () => ['auth.json', 'models.json', 'settings.json'].some(f => fs.existsSync(path.join(userPiDir, f)));
export const connections = {mode: piInstalled() ? 'pi' : 'rumi', local: [], ...readJson(connectionsFile, {})};
const saveConnections = () => fs.writeFileSync(connectionsFile, JSON.stringify(connections, null, 1));
if (!fs.existsSync(connectionsFile)) saveConnections();

const homeFor = mode => mode === 'pi' ? userPiDir : piDir;
export let runtime = null;
let available = [];

export async function loadRuntime() {
  const home = homeFor(connections.mode);
  runtime = await ModelRuntime.create({authPath: path.join(home, 'auth.json'), modelsPath: path.join(home, 'models.json'), modelsStorePath: path.join(piDir, 'models-store.json')});
  for (const l of connections.local) registerLocal(l);
  await listModels();
  return runtime;
}

// Switches between Rumi's own sign-ins and the ones shared with Pi.
export async function setConnectionMode(mode) {
  if (!['pi', 'rumi'].includes(mode)) throw Error('Unknown connection mode.');
  connections.mode = mode;
  saveConnections();
  await loadRuntime();
}

// --- local servers (LM Studio, Ollama) ---
export const LOCAL_SERVERS = [
  {id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'lmstudio'},
  {id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama'},
];
function registerLocal(l) {
  // A provider Pi already defines (for example in the user's models.json) is left alone.
  if (runtime.getProvider(l.id) && !runtime.getRegisteredProviderIds().includes(l.id)) return;
  runtime.registerProvider(l.id, {name: l.name, baseUrl: l.baseUrl, api: 'openai-completions', apiKey: l.apiKey,
    models: l.models.map(id => ({id, name: id, input: ['text'], contextWindow: 32768, maxTokens: 8192}))});
}
// Which local servers are running, and their models. added: Rumi connected it (so Rumi can remove it);
// connected: Pi knows it either way (for example from the user's own models.json).
const state = s => ({added: connections.local.some(l => l.id === s.id), connected: connections.local.some(l => l.id === s.id) || !!runtime.getModels(s.id).length});
export async function detectLocal() {
  return Promise.all(LOCAL_SERVERS.map(async s => {
    try {
      const r = await fetch(`${s.baseUrl}/models`, {signal: AbortSignal.timeout(1500)});
      const ids = r.ok ? ((await r.json()).data || []).map(m => m.id).filter(id => !/embed/i.test(id)) : [];
      return {...s, running: r.ok, models: ids, ...state(s)};
    } catch { return {...s, running: false, models: [], ...state(s)}; }
  }));
}
export async function connectLocal(id) {
  const s = (await detectLocal()).find(x => x.id === id);
  if (!s?.running) throw Error(`${s?.name || id} is not running on this computer.`);
  if (!s.models.length) throw Error(`${s.name} has no models loaded. Download or load one in ${s.name}, then try again.`);
  const entry = {id: s.id, name: s.name, baseUrl: s.baseUrl, apiKey: s.apiKey, models: s.models};
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
const describeModel = m => ({ref: `${m.provider}/${m.id}`, provider: m.provider, id: m.id, name: m.name, contextWindow: m.contextWindow, reasoning: !!m.reasoning});
export async function listModels() {
  try { available = await runtime.getAvailable(); } catch (e) { console.error('Model listing failed:', e.message); }
  return available.map(describeModel);
}
// The models from the last listing, without asking providers again.
export const knownModels = () => available.map(describeModel);
// Returns the Pi model for "provider/id", or throws a message the user can act on. Never substitutes.
export function resolveModel(ref) {
  if (!ref) throw Error('No model selected. Connect a model in Settings → Models.');
  const i = ref.indexOf('/');
  if (i < 1) throw Error(`Model "${ref}" should look like provider/model.`);
  const provider = ref.slice(0, i), id = ref.slice(i + 1), model = runtime.getModel(provider, id);
  if (!model) throw Error(`Model ${ref} is not known. Check Settings → Models.`);
  if (available.length && !available.some(m => m.provider === provider && m.id === id)) throw Error(`Model ${ref} is not connected. Sign in to ${provider} in Settings → Models.`);
  return model;
}

// --- Pi packages ---
// Rumi installs packages into its own Pi home (never the user's Pi). Which ones a task loads is decided per workspace.
const packageManager = () => new DefaultPackageManager({cwd: piDir, agentDir: piDir, settingsManager: SettingsManager.inMemory({})});
export const packageSource = name => name.startsWith('npm:') || name.startsWith('git:') || /^https?:/.test(name) ? name : `npm:${name.trim()}`;
export async function installPackage(source) {
  const pm = packageManager();
  await pm.install(source);
  const dir = pm.getInstalledPath(source, 'user');
  const pkg = readJson(path.join(dir || '', 'package.json'), {});
  return {source, name: pkg.name || source.replace(/^npm:/, ''), version: pkg.version || '', description: pkg.description || '', path: dir};
}
export async function removePackage(source) { await packageManager().remove(source); }

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

const under = (file, dir) => { const rel = path.relative(dir, file); return !rel.startsWith('..') && !path.isAbsolute(rel); };

// --- sessions ---
// One Pi session per task. ctl is the task's live control object (see pi/extension.mjs); folder is the
// project folder of the workspace, if any; packages are the opted-in Pi packages (local paths).
export async function makeSession({ctl, sessionFile, modelRef, kind, folder, outDir, sessionsDir, packages = [], userSkills = false, reasoning = 'auto', uiContext}) {
  fs.mkdirSync(outDir, {recursive: true});
  const cwd = folder || outDir;
  const model = resolveModel(modelRef);
  const settingsManager = SettingsManager.inMemory({
    compaction: {enabled: true},
    retry: {enabled: true, maxRetries: 4, baseDelayMs: 2000, maxAgentDelayMs: 60000},
    packages, extensions: [], skills: [],
  });
  // Skills: Rumi's own, the opted-in packages', the project's, and the user's personal ones only when they ask.
  // Pi also discovers ~/.agents/skills by itself, so skills from anywhere else are filtered out.
  const skillRoots = [rumiSkills, piDir, ...(folder ? [folder] : []), ...(userSkills ? [path.join(os.homedir(), '.agents', 'skills'), userPiDir] : [])];
  const skillPaths = [rumiSkills, ...(folder ? [path.join(folder, '.agents', 'skills'), path.join(folder, '.pi', 'skills')] : []), ...(userSkills ? [path.join(os.homedir(), '.agents', 'skills')] : [])];
  const loader = new DefaultResourceLoader({
    cwd, agentDir: piDir, settingsManager,
    extensionFactories: [rumiWorker(ctl)],
    additionalSkillPaths: skillPaths.filter(p => fs.existsSync(p)),
    noContextFiles: !folder, // a project's AGENTS.md; task folders have none worth reading
    noPromptTemplates: true, noThemes: true,
    systemPrompt: WORKER_PROMPT,
    skillsOverride: base => ({...base, skills: base.skills.filter(s => skillRoots.some(r => under(s.filePath, r)))}),
  });
  await loader.reload();
  // The kind decides Pi's built-in tools; tools from opted-in packages come on top.
  const own = new Set([...KINDS.build.tools, ...toolsFor('build')]);
  const packageTools = loader.getExtensions().extensions.flatMap(e => [...(e.tools?.keys?.() || [])]).filter(n => !own.has(n));
  const {session, extensionsResult} = await createAgentSession({
    cwd, agentDir: piDir, model, modelRuntime: runtime, resourceLoader: loader, settingsManager,
    thinkingLevel: reasoning === 'off' ? 'off' : KINDS[kind].thinking,
    tools: [...toolsFor(kind), ...packageTools],
    sessionManager: sessionFile ? SessionManager.open(sessionFile) : SessionManager.create(cwd, sessionsDir),
  });
  if (session.model && `${session.model.provider}/${session.model.id}` !== modelRef) { session.dispose(); throw Error(`Pi opened ${session.model.provider}/${session.model.id} instead of ${modelRef}; refusing to substitute.`); }
  await session.bindExtensions({uiContext, mode: 'rpc', onError: e => console.error(`Extension ${e.extensionPath}: ${e.error}`)});
  const errors = extensionsResult.errors.map(e => `${path.basename(e.path)}: ${e.error}`);
  return {session, errors};
}
