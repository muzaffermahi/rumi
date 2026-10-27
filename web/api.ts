// Talking to Rumi's local server, and the shapes it sends.

export class Locked extends Error {}
export class Conflict extends Error {
  constructor(
    message: string,
    public current: {html: string; revision: number},
  ) {
    super(message);
  }
}
let onLocked: () => void = () => {};
export const whenLocked = (fn: () => void) => {
  onLocked = fn;
};

export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(`/api${url}`, {method, headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  if (r.status === 401) {
    onLocked();
    throw new Locked('Rumi is locked. Open it with the rumi command.');
  }
  const data = await r.json().catch(() => null);
  if (r.status === 409 && data?.conflict) throw new Conflict(data.error, data);
  if (!r.ok) throw Error(data?.error || r.statusText);
  return data as T;
}

export type Step = {id: string; tool: string; detail: string; state: 'running' | 'ok' | 'failed'; at: number; ms?: number; output?: string};
export type Activity = {startedAt: number; lastAt: number; phase: string; thinking: string; steps: Step[]};
export type Queued = {kind: string; text: string; passage?: string | null; context?: boolean};
export type Handback = {answer: string; summary: string; notes: string; assumptions: string[]; files?: string[]; at?: number};
export type Question = {question: string; options: string[]; why: string; at?: number};
export type Dialog = {
  id: string;
  kind: 'select' | 'confirm' | 'input';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};
export type Usage = {input: number; output: number; cacheRead: number; total: number; cost: number};
export type Task = {
  id: string;
  title: string;
  kind: string;
  status: string;
  model: string;
  created: string;
  files: string[];
  error?: string | null;
  projectDir?: string;
  docId: string | null;
  documentWide: boolean;
  version: number;
  live: string;
  activeTool: string | null;
  activity: Activity | null;
  queued: Queued[];
  pendingContext: boolean;
  started: boolean;
  passage: string;
  objective: string;
  suggestion: {text: string; summary: string; raw: boolean; at: number} | null;
  handback: Handback | null;
  question: Question | null;
  dialog: Dialog | null;
  stalled: boolean;
  notice: {message: string; type?: string} | null;
  warnings: string[];
  usage: Usage | null;
  elapsed: number;
  finishedAt: string | null;
  archived: boolean;
  group: string;
  changes: {count: number; reverted: boolean} | null;
  worktree: string | null;
};
export type Model = {
  ref: string;
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning?: boolean;
  local?: boolean;
  subscription?: boolean;
};
export type Folder = {path: string; name: string; isRepo: boolean};
export type DocMeta = {id: string; title: string; created: string; updated: string; archived: boolean};
export type Workspace = {
  id: string;
  name: string;
  path: string | null;
  isRepo: boolean;
  packages?: string[];
  mcp?: string[];
  readme?: boolean;
  docs?: DocMeta[];
};
export type Package = {source: string; name: string; version: string; description: string};
export type McpServer = {kind: 'http' | 'stdio'; description: string; target: string};
export type Shortcuts = {delegate: string; palette: string; newDocument: string; focusMode: string; shortcuts: string};
export type Settings = {
  defaultModel: string;
  maxWorkers: number;
  sameFolder: boolean;
  reasoning: 'auto' | 'off';
  userSkills: boolean;
  packages: Package[];
  theme: 'system' | 'light' | 'dark';
  notifications: boolean;
  approvals: 'off' | 'after-web' | 'always';
  checkpoints: boolean;
  worktrees: boolean;
  allowPrivateNetwork: boolean;
  updateCheck: boolean;
  search: {providers: string[]; searxngUrl: string; braveApiKey: boolean; tavilyApiKey: boolean};
  mcpServers: Record<string, McpServer>;
  shortcuts: Shortcuts;
  lastKind: string;
  recentFolders: Folder[];
};
export type Kind = {label: string; hint: string; needsFolder: boolean; source: string};
export type Kinds = Record<string, Kind>;
export type Preset = {id: string; label: string; kind: string | null; instruction: string; source: string};
export type Update = {current: string; latest: string | null; available: boolean; url: string; notes: string; install: {kind: string; how: string}};
export type Snapshot = {
  workspace: Workspace;
  workspaces: Workspace[];
  tasks: Task[];
  settings: Settings;
  running: number;
  ready: boolean;
  version: string;
  build: string;
  onboarded: boolean;
  update: Update | null;
  kinds: Kinds;
  kindErrors: string[];
  presets: Preset[];
};

export const fileUrl = (taskId: string, name: string, view = false) => `/api/tasks/${taskId}/files/${encodeURIComponent(name)}${view ? '?view' : ''}`;

export function since(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));
export const cost = (usd: number) => (usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? '<$0.01' : '');

export const statusLabel: Record<string, string> = {
  running: 'Working',
  queued: 'Queued',
  finished: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  interrupted: 'Interrupted',
  'needs-you': 'Needs you',
};
// What a task is waiting on, if it is waiting on the user.
export const waitingOnUser = (t: Task) => t.status === 'needs-you' || !!t.dialog;
export const statusOf = (t: Task) => (t.dialog ? 'Needs you' : t.stalled ? 'Stalled' : statusLabel[t.status] || t.status);
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
