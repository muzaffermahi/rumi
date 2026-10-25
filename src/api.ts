export async function api(url: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + url, {method, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  if (!r.ok) throw Error((await r.json().catch(() => null))?.error || r.statusText);
  return r.json();
}

export type Step = {id: string; tool: string; detail: string; state: 'running' | 'ok' | 'failed'; at: number; ms?: number; output?: string};
export type Activity = {startedAt: number; lastAt: number; phase: string; thinking: string; steps: Step[]};
export type Queued = {kind: string; text: string; passage?: string | null; context?: boolean};
export type Task = {
  id: string; title: string; status: string; model: string; created: string; files: string[]; error?: string | null;
  projectDir?: string; documentWide: boolean; version: number; live: string; activeTool: string | null; activity: Activity | null;
  queued: Queued[]; pendingContext: boolean; started: boolean; passage: string; suggestion: {text: string; at: number} | null;
};
export type Model = {ref: string; provider: string; id: string; name: string; contextWindow: number};
export type Folder = {path: string; name: string; isRepo: boolean};
export type Workspace = {id: string; name: string; path: string | null; isRepo: boolean};
export type Settings = {defaultModel: string; maxWorkers: number; sameFolder?: boolean; recentFolders?: Folder[]};

export const fileUrl = (taskId: string, name: string, view = false) => `/api/tasks/${taskId}/files/${encodeURIComponent(name)}${view ? '?view' : ''}`;

export function since(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export const statusLabel: Record<string, string> = {running: 'Working', queued: 'Queued', finished: 'Done', failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted'};
