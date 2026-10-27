// Your settings, in <data>/config.json. The Settings page reads and writes the same file, so you can edit either.
// A project can override the per-task settings (PROJECT_KEYS) in <project>/.rumi/config.json.
// FIELDS is the single description of every setting: it validates changes and generates schema/config.schema.json.
import fs from 'node:fs';
import path from 'node:path';
import {configFile, readJson, writePrivate} from './paths.mjs';

export const SEARCH_PROVIDERS = ['exa', 'duckduckgo', 'bing', 'brave', 'tavily', 'searxng'];

const bool = (description, dflt) => ({type: 'boolean', description, default: dflt});
const str = (description, dflt = '') => ({type: 'string', description, default: dflt});
const oneOf = (values, description, dflt) => ({type: 'string', enum: values, description, default: dflt});

export const FIELDS = {
  defaultModel: str('Model for new tasks, as provider/model (for example anthropic/claude-sonnet-4-5).'),
  maxWorkers: {type: 'integer', minimum: 1, maximum: 5, description: 'How many tasks run at once.', default: Number(process.env.RUMI_MAX_WORKERS) || 2},
  sameFolder: bool('Let two Build tasks change the same project folder at the same time, without giving the second its own copy.', false),
  reasoning: oneOf(['auto', 'off'], 'auto: more thinking for Think tasks, less for Write. off: faster, for small local models.', 'auto'),
  userSkills: bool('Also offer your personal skills in ~/.agents/skills to workers.', false),
  theme: oneOf(['system', 'light', 'dark'], 'Colour theme.', 'system'),
  notifications: bool('Show a browser notification when a task finishes or needs you while Rumi is in the background.', false),
  approvals: oneOf(
    ['off', 'after-web', 'always'],
    'When Build tasks must ask before running a shell command: never, after the task has read a web page (default), or always.',
    'after-web',
  ),
  checkpoints: bool('Snapshot the project folder before each Build task so its changes can be reviewed and reverted.', true),
  worktrees: bool('Run Build tasks in a separate git worktree and branch, merged when you choose. Git repositories only.', false),
  allowPrivateNetwork: bool('Let read_page open addresses on this computer or your local network. Off protects against prompt injection.', false),
  updateCheck: bool('Check GitHub once a day for a newer version. Nothing about you is sent.', true),
  search: {
    type: 'object',
    description: 'Web search for workers.',
    additionalProperties: false,
    properties: {
      providers: {
        type: 'array',
        items: {type: 'string', enum: SEARCH_PROVIDERS},
        description: 'Engines queried together and merged. Bing is used as a fallback when all return nothing.',
        default: ['exa', 'duckduckgo'],
      },
      braveApiKey: str('Brave Search API key (https://brave.com/search/api).'),
      tavilyApiKey: str('Tavily API key (https://tavily.com).'),
      searxngUrl: str('Base URL of a SearXNG instance with the JSON format enabled, for example http://localhost:8888.'),
    },
    default: {},
  },
  mcpServers: {
    type: 'object',
    description: 'MCP servers workers can use, in the same format as Claude Desktop, Cursor and Pi. Turn each one on per workspace.',
    additionalProperties: {type: 'object'},
    default: {},
  },
  shortcuts: {
    type: 'object',
    description: 'Keyboard shortcuts. Mod is Ctrl, or Cmd on macOS.',
    additionalProperties: false,
    properties: {
      delegate: str('Delegate the selection.', 'Mod+Enter'),
      palette: str('Open the command palette.', 'Mod+K'),
      newDocument: str('New document.', 'Mod+Alt+N'),
      focusMode: str('Toggle focus mode.', 'Mod+Shift+F'),
      shortcuts: str('Show keyboard shortcuts.', 'Shift+?'),
    },
    default: {},
  },
  packages: {
    type: 'array',
    description: 'Pi packages installed in Rumi (managed from Settings).',
    items: {type: 'object', properties: {source: {type: 'string'}, name: {type: 'string'}, version: {type: 'string'}, description: {type: 'string'}}},
    default: [],
  },
};

// Settings a project's .rumi/config.json may override for its own tasks.
export const PROJECT_KEYS = ['defaultModel', 'reasoning', 'approvals', 'checkpoints', 'worktrees', 'allowPrivateNetwork', 'search'];

const defaults = () => Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.default)]));
const nestedDefaults = key => Object.fromEntries(Object.entries(FIELDS[key].properties).map(([k, f]) => [k, structuredClone(f.default)]));

// Returns an error message for a value that doesn't fit its field, or null.
function check(field, value, name) {
  if (field.type === 'boolean' && typeof value !== 'boolean') return `${name} must be true or false.`;
  if (field.type === 'string' && typeof value !== 'string') return `${name} must be text.`;
  if (field.enum && !field.enum.includes(value)) return `${name} must be one of: ${field.enum.join(', ')}.`;
  if (field.type === 'integer' && (!Number.isInteger(value) || value < field.minimum || value > field.maximum))
    return `${name} must be a whole number from ${field.minimum} to ${field.maximum}.`;
  if (field.type === 'array') {
    if (!Array.isArray(value)) return `${name} must be a list.`;
    if (field.items?.enum) for (const v of value) if (!field.items.enum.includes(v)) return `${name} can only contain: ${field.items.enum.join(', ')}.`;
  }
  if (field.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${name} must be an object.`;
    if (field.properties) {
      for (const [k, v] of Object.entries(value)) {
        if (!field.properties[k]) return `${name}.${k} is not a setting.`;
        const e = check(field.properties[k], v, `${name}.${k}`);
        if (e) return e;
      }
    }
  }
  return null;
}

export function validate(patch, keys = Object.keys(FIELDS)) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === '$schema') continue;
    if (!keys.includes(k)) return `${k} is not a setting.`;
    const e = check(FIELDS[k], v, k);
    if (e) return e;
  }
  return null;
}

// Fills in defaults and drops what doesn't validate, so a hand-edited file with a typo still starts.
function normalise(raw, problems) {
  const out = defaults();
  for (const [k, v] of Object.entries(raw || {})) {
    if (k === '$schema') continue;
    const e = validate({[k]: v});
    if (e) problems.push(e);
    else out[k] = FIELDS[k].properties ? {...nestedDefaults(k), ...v} : v;
  }
  for (const k of ['search', 'shortcuts']) out[k] = {...nestedDefaults(k), ...out[k]};
  return out;
}

export const configProblems = [];
export const config = normalise(readJson(configFile, {}), configProblems);
if (configProblems.length) console.error(`config.json: ${configProblems.join(' ')} Using the defaults for those.`);

export function saveConfig() {
  const out = {$schema: 'https://raw.githubusercontent.com/muzaffermahi/rumi/main/schema/config.schema.json'};
  const base = defaults();
  for (const [k, v] of Object.entries(config)) {
    const plain = FIELDS[k].properties ? {...nestedDefaults(k)} : base[k];
    if (JSON.stringify(v) !== JSON.stringify(plain)) out[k] = v;
  }
  writePrivate(configFile, `${JSON.stringify(out, null, 2)}\n`); // may hold API keys
}

// Applies a validated change from the Settings page or the API. Returns an error message or null.
export function updateConfig(patch) {
  const error = validate(patch);
  if (error) return error;
  for (const [k, v] of Object.entries(patch)) config[k] = FIELDS[k].properties ? {...config[k], ...v} : v;
  saveConfig();
  return null;
}

// Earlier versions kept settings in SQLite; they move to config.json once.
export function adoptLegacySettings(old) {
  if (fs.existsSync(configFile) || !old) return false;
  const patch = {};
  for (const k of ['defaultModel', 'maxWorkers', 'sameFolder', 'reasoning', 'userSkills', 'packages'])
    if (old[k] !== undefined && !validate({[k]: old[k]})) patch[k] = old[k];
  Object.assign(config, patch);
  saveConfig();
  return true;
}

export function projectConfig(folder) {
  if (!folder) return {};
  const raw = readJson(path.join(folder, '.rumi', 'config.json'), {});
  const out = {};
  for (const k of PROJECT_KEYS) if (raw[k] !== undefined && !validate({[k]: raw[k]})) out[k] = raw[k];
  return out;
}

// The settings that apply to a task in this folder: yours, with the project's overrides on top.
export function effective(folder) {
  const p = projectConfig(folder);
  return {...config, ...p, search: {...config.search, ...p.search}};
}

// What the browser may see: everything except secrets, which are reported as set or not.
export function publicConfig() {
  const {search, mcpServers, ...rest} = config;
  return {
    ...rest,
    search: {providers: search.providers, searxngUrl: search.searxngUrl, braveApiKey: !!search.braveApiKey, tavilyApiKey: !!search.tavilyApiKey},
    mcpServers: Object.fromEntries(
      Object.entries(mcpServers).map(([name, s]) => [
        name,
        {kind: s.url ? 'http' : 'stdio', description: s.description || '', target: s.url || [s.command, ...(s.args || [])].join(' ')},
      ]),
    ),
  };
}

export function jsonSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://raw.githubusercontent.com/muzaffermahi/rumi/main/schema/config.schema.json',
    title: 'Rumi settings',
    type: 'object',
    additionalProperties: false,
    properties: {$schema: {type: 'string'}, ...FIELDS},
  };
}
