import {useEffect, useState} from 'react';
import {api, since} from '../api';
import {useToasts} from '../Toasts';

type Version = {index: number; rev: number; at: string; label: string; words: number};

// Earlier versions of the document: Rumi keeps one every ten minutes of writing, and one before it changes the
// document for you (inserting an answer, restoring). Pick one to preview it in place, then restore it or go back.
export function History({
  wid,
  docId,
  onPreview,
  onRestored,
  onClose,
}: {
  wid: string;
  docId: string;
  onPreview: (html: string | null) => void;
  onRestored: () => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const toast = useToasts();
  useEffect(() => {
    api<Version[]>(`/w/${wid}/docs/${docId}/history`).then(setVersions, toast.error);
    return () => onPreview(null);
  }, [wid, docId]);
  async function pick(v: Version) {
    setPicked(v.index);
    try {
      onPreview((await api<{html: string}>(`/w/${wid}/docs/${docId}/history/${v.index}`)).html);
    } catch (e) {
      toast.error(e);
    }
  }
  async function restore() {
    if (picked === null) return;
    try {
      await api(`/w/${wid}/docs/${docId}/restore`, 'POST', {index: picked});
      onPreview(null);
      onRestored();
      toast.notify('Restored. The version before it is kept in the history too.');
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <aside className="history" aria-label="Version history">
      <div className="history-head">
        <b>Version history</b>
        <button className="ghost close" onClick={onClose} aria-label="Close history">
          ×
        </button>
      </div>
      {picked !== null && (
        <div className="preview-note">
          <span className="grow">Previewing an earlier version</span>
          <button className="primary" onClick={restore}>
            Restore
          </button>
          <button
            className="ghost"
            onClick={() => {
              setPicked(null);
              onPreview(null);
            }}
          >
            Back
          </button>
        </div>
      )}
      <div className="history-list">
        {!versions && <p className="quiet pad">Loading…</p>}
        {versions && !versions.length && <p className="quiet pad">No earlier versions yet. Rumi keeps one every ten minutes while you write.</p>}
        {versions?.map(v => (
          <button key={v.index} className={`version${picked === v.index ? ' on' : ''}`} onClick={() => pick(v)}>
            {v.label || new Date(v.at).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
            <small>
              {since(v.at)} · {v.words.toLocaleString()} words
            </small>
          </button>
        ))}
      </div>
    </aside>
  );
}
