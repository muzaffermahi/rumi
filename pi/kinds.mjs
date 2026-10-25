// Task kinds: what sort of help a delegated task is. Each kind is a small Pi configuration —
// which tools the worker gets, how hard the model thinks, and whether web research is required.
// Every kind also gets Rumi's own tools: offer_document, finish and ask_user.

export const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
export const RUMI_TOOLS = ['offer_document', 'finish', 'ask_user'];
const WEB = ['web_search', 'read_page'];

export const KINDS = {
  research: {
    label: 'Research',
    hint: 'Look things up and bring back what you found, with sources',
    tools: ['read', 'ls', 'write', ...WEB],
    thinking: 'medium',
    searchMin: 5,
    guide: 'This is a research task. Plan your searches, run at least 5 distinct web_search queries, read the best sources with read_page, and cite them. Prefer primary sources (official sites, papers, filings) over summaries.',
  },
  write: {
    label: 'Write',
    hint: 'Draft or rewrite text in your voice',
    tools: ['read', 'ls', 'write', ...WEB],
    thinking: 'low',
    searchMin: 0,
    guide: 'This is a writing task. Your answer is prose the user can drop into their document: match their language, tone and level of formality. Look facts up only when the text depends on them.',
  },
  think: {
    label: 'Think',
    hint: 'Critique, plan, find gaps, weigh options',
    tools: ['read', 'ls', 'write', ...WEB],
    thinking: 'high',
    searchMin: 0,
    guide: 'This is a thinking task: critique, plan, compare or find what is missing. Be direct and specific; say what you would do and why. Look facts up when your reasoning depends on them.',
  },
  build: {
    label: 'Build',
    hint: 'Change files in this project folder',
    tools: ['read', 'ls', 'write', 'edit', SHELL, ...WEB],
    thinking: 'medium',
    searchMin: 0,
    needsFolder: true,
    guide: 'This task changes the project. Read before you edit, keep changes focused on the task, and check your work (build, tests or a run) when the project has a way to. Report exactly what you changed and what you verified.',
  },
};

export const DEFAULT_KIND = 'research';

// The kind a request asks for, falling back to the default. Build needs a project folder.
export function kindFor(name, {hasFolder = false} = {}) {
  const key = KINDS[name] ? name : DEFAULT_KIND;
  if (KINDS[key].needsFolder && !hasFolder) throw Error(`${KINDS[key].label} tasks need a project folder. Open a folder workspace first.`);
  return key;
}

export const toolsFor = kind => [...KINDS[kind].tools, ...RUMI_TOOLS];

// v1–v3 tasks had a research checkbox instead of a kind.
export const legacyKind = t => t.kind || (t.research === false ? 'write' : 'research');
