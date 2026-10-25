export async function api(url: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + url, {method, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok) throw Error((await r.json().catch(() => null))?.error || r.statusText);
  return r.json();
}

export type Step = {id: string; tool: string; detail: string; state: 'running' | 'ok' | 'failed'; at: number; ms?: number; output?: string};
export type Activity = {startedAt: number; lastAt: number; phase: string; thinking: string; steps: Step[]};
export type Queued = {kind: string; text: string; passage?: string | null; context?: boolean};
export type Handback = {answer: string; summary: string; notes: string; assumptions: string[]; files?: string[]; at?: number};
export type Question = {question: string; options: string[]; why: string; at?: number};
export type Dialog = {id: string; kind: 'select' | 'confirm' | 'input'; title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string};
export type Task = {
  id: string; title: string; kind: string; status: string; model: string; created: string; files: string[]; error?: string | null;
  projectDir?: string; documentWide: boolean; version: number; live: string; activeTool: string | null; activity: Activity | null;
  queued: Queued[]; pendingContext: boolean; started: boolean; passage: string;
  suggestion: {text: string; summary: string; raw: boolean; at: number} | null; handback: Handback | null;
  question: Question | null; dialog: Dialog | null; stalled: boolean; notice: {message: string; type?: string} | null; warnings: string[];
};
export type Model = {ref: string; provider: string; id: string; name: string; contextWindow: number};
export type Folder = {path: string; name: string; isRepo: boolean};
export type Workspace = {id: string; name: string; path: string | null; isRepo: boolean; brief?: string; packages?: string[]; readme?: boolean};
export type Package = {source: string; name: string; version: string; description: string};
export type Settings = {defaultModel: string; maxWorkers: number; sameFolder?: boolean; recentFolders?: Folder[]; reasoning: 'auto' | 'off'; userSkills: boolean; packages: Package[]; lastKind: string};
export type Kinds = Record<string, {label: string; hint: string; needsFolder: boolean}>;

export const fileUrl = (taskId: string, name: string, view = false) => `/api/tasks/${taskId}/files/${encodeURIComponent(name)}${view ? '?view' : ''}`;

export function since(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export const statusLabel: Record<string, string> = {running: 'Working', queued: 'Queued', finished: 'Done', failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted', 'needs-you': 'Needs you'};
// What a task is waiting on, if it is waiting on the user.
export const waitingOnUser = (t: Task) => t.status === 'needs-you' || !!t.dialog;
export const statusOf = (t: Task) => t.dialog ? 'Needs you' : t.stalled ? 'Stalled' : statusLabel[t.status] || t.status;
