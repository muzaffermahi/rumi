import React, {useEffect, useRef, useState} from 'react';
import {api, type Folder} from './api';

// Picks a folder (project, repo): the system picker, a recent one, or a pasted path. Used to switch workspaces.
export function FolderChooser({folder, recent, onChange, onError, none = {label: 'No folder', hint: 'works in its own task folder', menu: 'No folder'}}: {
  folder: Folder | null; recent: Folder[]; onChange: (f: Folder | null) => void; onError: (m: string) => void; none?: {label: string; hint: string; menu: string};
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setTyping(false); } };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const choose = (f: Folder | null) => { onChange(f); setOpen(false); setTyping(false); };
  async function browse() {
    setPicking(true);
    try {
      const r = await api('/folders/pick', 'POST', {start: folder?.path});
      if (r.folder) choose(r.folder);
    } catch (e: any) { onError(e.message); setTyping(true); }
    finally { setPicking(false); }
  }
  async function check() {
    if (!typed.trim()) return;
    try { choose((await api('/folders/check', 'POST', {path: typed})).folder); setTyped(''); } catch (e: any) { onError(e.message); }
  }

  return <div className="folder" ref={box}>
    <button type="button" className="folder-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} title={folder?.path || none.hint}>
      <span className="folder-icon" aria-hidden>{folder ? '▣' : '□'}</span>
      <span className="folder-label">{folder ? folder.name : none.label}</span>
      {folder?.isRepo && <span className="badge">repo</span>}
      <span className="folder-hint">{folder ? folder.path : none.hint}</span>
      <span aria-hidden>▾</span>
    </button>
    {open && <div className="folder-menu" role="menu">
      <button role="menuitem" disabled={picking} onClick={browse}>{picking ? 'Waiting for the folder picker…' : 'Open a folder…'}</button>
      {recent.length > 0 && <div className="menu-label">Recent</div>}
      {recent.map(f => <div key={f.path} className={'recent' + (folder?.path === f.path ? ' current' : '')}>
        <button role="menuitem" onClick={() => choose(f)} title={f.path}><b>{f.name}</b>{f.isRepo && <span className="badge">repo</span>}<small>{f.path}</small></button>
        <button className="forget" aria-label={`Remove ${f.name} from recent folders`} onClick={() => api('/folders/forget', 'POST', {path: f.path}).catch(e => onError(e.message))}>×</button>
      </div>)}
      {typing
        ? <input autoFocus aria-label="Folder path" placeholder="Paste a folder path, then Enter" value={typed} onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); check(); } if (e.key === 'Escape') { e.stopPropagation(); setTyping(false); } }}/>
        : <button role="menuitem" onClick={() => setTyping(true)}>Paste a path…</button>}
      {folder && <button role="menuitem" onClick={() => choose(null)}>{none.menu}</button>}
    </div>}
  </div>;
}
