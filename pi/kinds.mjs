// Task kinds: what sort of help a delegated task is. Each kind is a Markdown file — front matter for the label,
// the tools the worker gets, how hard the model thinks and how much research is required; the body is the guide the
// worker reads. Rumi's own are in pi/kinds/. Yours go in <data>/kinds/, a project's in <project>/.rumi/kinds/;
// a file with the same name as a built-in one replaces it. Every kind also gets Rumi's own tools.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMarkdownDir} from '../server/frontmatter.mjs';
import {dataDir} from '../server/paths.mjs';

export const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
export const RUMI_TOOLS = ['offer_document', 'finish', 'ask_user'];
// Tools a kind may list. `shell` means PowerShell on Windows and bash elsewhere.
export const KIND_TOOLS = ['read', 'ls', 'grep', 'find', 'write', 'edit', 'shell', 'web_search', 'read_page'];
const THINKING = ['off', 'minimal', 'low', 'medium', 'high'];
const builtinDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kinds');

// Turns a parsed file into a kind, or throws a message saying what is wrong with it.
export function toKind(key, {data, body}, source = 'builtin') {
  if (!/^[a-z0-9-]+$/.test(key)) throw Error(`${key}.md: kind file names may only use a–z, 0–9 and -`);
  const tools = (Array.isArray(data.tools) ? data.tools : ['read', 'ls', 'write', 'web_search', 'read_page']).map(String);
  const unknown = tools.filter(t => !KIND_TOOLS.includes(t));
  if (unknown.length) throw Error(`${key}.md: unknown tools ${unknown.join(', ')} (allowed: ${KIND_TOOLS.join(', ')})`);
  const thinking = data.thinking ?? 'medium';
  if (!THINKING.includes(thinking)) throw Error(`${key}.md: thinking must be one of ${THINKING.join(', ')}`);
  const searchMin = Number(data.searchMin ?? 0);
  if (!Number.isInteger(searchMin) || searchMin < 0 || searchMin > 30) throw Error(`${key}.md: searchMin must be 0–30`);
  if (searchMin > 0 && !tools.includes('web_search')) throw Error(`${key}.md: searchMin needs the web_search tool`);
  const needsFolder = !!data.needsFolder || tools.includes('edit') || tools.includes('shell');
  return {
    key,
    source,
    label: String(data.label || key),
    hint: String(data.hint || ''),
    order: Number(data.order ?? 50),
    tools: tools.map(t => (t === 'shell' ? SHELL : t)),
    thinking,
    searchMin,
    needsFolder,
    guide: body || `This is a ${data.label || key} task.`,
  };
}

function load(dirs) {
  const kinds = {},
    errors = [];
  for (const [key, file] of readMarkdownDir(dirs)) {
    try {
      kinds[key] = toKind(key, file, file.source);
    } catch (e) {
      errors.push(e.message);
    }
  }
  return {kinds: Object.fromEntries(Object.entries(kinds).sort(([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label))), errors};
}

// Rumi's own kinds, always available.
export const KINDS = load([{dir: builtinDir, source: 'builtin'}]).kinds;
export const DEFAULT_KIND = 'research';

// The kinds for a workspace: Rumi's, yours, then the project's.
export function kindsFor(folder) {
  return load([
    {dir: builtinDir, source: 'builtin'},
    {dir: path.join(dataDir, 'kinds'), source: 'user'},
    ...(folder ? [{dir: path.join(folder, '.rumi', 'kinds'), source: 'project'}] : []),
  ]);
}

// A task's kind, even if its file was removed since: then the built-in one of that name, or Research.
export const kindOf = (name, folder) => kindsFor(folder).kinds[name] || KINDS[name] || KINDS[DEFAULT_KIND];

// The kind a request asks for, falling back to the default. Kinds that change files need a project folder.
export function kindFor(name, {hasFolder = false, folder} = {}) {
  const kinds = kindsFor(folder).kinds;
  const key = kinds[name] ? name : DEFAULT_KIND;
  if (kinds[key].needsFolder && !hasFolder) throw Error(`${kinds[key].label} tasks need a project folder. Open a folder workspace first.`);
  return key;
}

export const toolsFor = (kind, folder) => [...kindOf(kind, folder).tools, ...RUMI_TOOLS];

// v1–v3 tasks had a research checkbox instead of a kind.
export const legacyKind = t => t.kind || (t.research === false ? 'write' : 'research');
