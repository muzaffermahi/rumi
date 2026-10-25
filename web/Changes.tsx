import {useEffect, useState} from 'react';
import {api, type Task} from './api';
import {useToasts} from './Toasts';

type FileChange = {status: string; path: string};
type Result = {
  mode: 'checkpoint' | 'worktree' | 'none';
  running?: boolean;
  files: FileChange[];
  stat?: string;
  patch?: string;
  cut?: boolean;
  reverted?: {at: string} | null;
  branch?: string;
  dir?: string;
};

// What a Build task changed in the project: the files and their diffs, with Revert (checkpoints) or Merge and Discard
// (worktrees).
export function Changes({task}: {task: Task}) {
  const [r, setR] = useState<Result | null>(null);
  const [busy, setBusy] = useState('');
  const toast = useToasts();
  const load = () => api<Result>(`/tasks/${task.id}/changes`).then(setR, toast.error);
  useEffect(() => {
    load();
  }, [task.id, task.version, task.changes?.reverted, task.worktree]);

  async function act(label: string, url: string, done: string) {
    setBusy(label);
    try {
      await api(`/tasks/${task.id}/${url}`, 'POST');
      toast.notify(done);
      await load();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  }

  if (!r)
    return (
      <div className="changes">
        <p className="quiet">Reading the changes…</p>
      </div>
    );
  if (r.mode === 'none')
    return (
      <div className="changes">
        <p className="quiet">This task has no checkpoint. Turn on checkpoints in Settings → Workers to review and revert what Build tasks change.</p>
      </div>
    );
  if (r.running)
    return (
      <div className="changes">
        <p className="quiet">The task is still working. Its changes appear here when the step ends.</p>
      </div>
    );
  const patches = splitPatch(r.patch || '');
  return (
    <div className="changes">
      <div className="changes-head">
        <span className="grow">
          {r.files.length ? `${r.files.length} file${r.files.length === 1 ? '' : 's'} changed` : 'No files changed'}
          {r.stat && <span className="quiet"> · {r.stat.replace(/^\s*\d+ files? changed,?\s*/, '')}</span>}
          {r.mode === 'worktree' && <span className="quiet"> · on branch {r.branch}</span>}
        </span>
        {r.mode === 'checkpoint' && !r.reverted && !!r.files.length && (
          <button
            className="danger-btn"
            disabled={!!busy}
            onClick={() =>
              confirm('Put these files back as they were before this task? The current state is kept, so you can undo this.') &&
              act('revert', 'revert', 'Reverted. You can undo this here.')
            }
          >
            {busy === 'revert' ? 'Reverting…' : 'Revert these changes'}
          </button>
        )}
        {r.mode === 'checkpoint' && r.reverted && (
          <button className="secondary" disabled={!!busy} onClick={() => act('unrevert', 'unrevert', 'The task’s changes are back.')}>
            {busy === 'unrevert' ? 'Restoring…' : 'Undo revert'}
          </button>
        )}
        {r.mode === 'worktree' && (
          <>
            <button className="primary" disabled={!!busy || !r.files.length} onClick={() => act('merge', 'merge', 'Merged into your branch.')}>
              {busy === 'merge' ? 'Merging…' : 'Merge into my branch'}
            </button>
            <button
              className="danger-btn"
              disabled={!!busy}
              onClick={() => confirm('Discard this task’s branch and worktree? Its changes are lost.') && act('discard', 'discard', 'Discarded.')}
            >
              Discard
            </button>
          </>
        )}
      </div>
      {r.reverted && <p className="quiet">Reverted {new Date(r.reverted.at).toLocaleString()}. Below is what the task had changed.</p>}
      {r.mode === 'worktree' && r.dir && (
        <p className="quiet">
          Working copy: <code>{r.dir}</code>
        </p>
      )}
      {r.files.map(f => (
        <details key={f.path} className="change-file" open={r.files.length <= 4}>
          <summary>
            <span className={`st ${f.status}`}>{f.status}</span>
            {f.path}
          </summary>
          <div className="patch">
            {(patches.get(f.path) || []).map((line, i) => (
              <div key={i} className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : ''}>
                {line || ' '}
              </div>
            ))}
            {!patches.get(f.path)?.length && <div className="hunk">Binary file, or too large to show.</div>}
          </div>
        </details>
      ))}
      {r.cut && <p className="quiet">The diff is long; only the start is shown.</p>}
    </div>
  );
}

// Splits a unified diff into each file's changed lines (without the headers).
function splitPatch(patch: string) {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const line of patch.split('\n')) {
    const head = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (head) {
      cur = [];
      out.set(head[2], cur);
      continue;
    }
    if (!cur || /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(line)) continue;
    cur.push(line);
  }
  return out;
}
