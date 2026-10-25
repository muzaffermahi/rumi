import {useEffect, useRef, useState} from 'react';
import {api, type Folder} from './api';
import {Icon} from './Icon';

// Switching workspace: Global, a recent folder, the system's folder picker, Rumi's own folder browser, or a pasted path.
export function FolderChooser({
  folder,
  recent,
  onChange,
  onError,
}: {
  folder: Folder | null;
  recent: Folder[];
  onChange: (f: Folder | null) => void;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [typed, setTyped] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setTyping(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const choose = (f: Folder | null) => {
    onChange(f);
    setOpen(false);
    setTyping(false);
    setBrowsing(false);
  };
  async function pick() {
    setPicking(true);
    try {
      const r = await api('/folders/pick', 'POST', {start: folder?.path});
      if (r.folder) choose(r.folder);
    } catch {
      setBrowsing(true); // no system picker here: use Rumi's own
    } finally {
      setPicking(false);
    }
  }
  async function check() {
    if (!typed.trim()) return;
    try {
      choose((await api('/folders/check', 'POST', {path: typed})).folder);
      setTyped('');
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div className="folder" ref={box}>
      <button
        type="button"
        className="folder-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={folder?.path || 'Your workspace outside any project'}
      >
        <span className="folder-icon" aria-hidden>
          <Icon name={folder ? 'folder' : 'globe'} size={14} />
        </span>
        <span className="folder-label">{folder ? folder.name : 'Global'}</span>
        {folder?.isRepo && <span className="badge">repo</span>}
        <span className="folder-spacer" />
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="folder-menu" role="menu">
          <button role="menuitem" className="primary-item" disabled={picking} onClick={pick}>
            {picking ? 'Waiting for the folder picker…' : 'Open a folder…'}
          </button>
          <button role="menuitem" onClick={() => setBrowsing(true)}>
            Browse folders…
          </button>
          {folder && (
            <button role="menuitem" onClick={() => choose(null)}>
              Global workspace
            </button>
          )}
          {recent.length > 0 && <div className="menu-label">Recent</div>}
          {recent.map(f => (
            <div key={f.path} className={`recent${folder?.path === f.path ? ' current' : ''}`}>
              <button role="menuitem" onClick={() => choose(f)} title={f.path}>
                <b>{f.name}</b>
                {f.isRepo && <span className="badge">repo</span>}
                <small>{f.path}</small>
              </button>
              <button
                className="forget"
                aria-label={`Remove ${f.name} from recent folders`}
                onClick={() => api('/folders/forget', 'POST', {path: f.path}).catch(onError)}
              >
                ×
              </button>
            </div>
          ))}
          {typing ? (
            <input
              autoFocus
              aria-label="Folder path"
              placeholder="Paste a folder path, then Enter"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  check();
                }
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setTyping(false);
                }
              }}
            />
          ) : (
            <button role="menuitem" onClick={() => setTyping(true)}>
              Paste a path…
            </button>
          )}
        </div>
      )}
      {browsing && <FolderBrowser start={folder?.path} onChoose={choose} onClose={() => setBrowsing(false)} onError={onError} />}
    </div>
  );
}

type Listing = {path: string; name: string; isRepo: boolean; parent: string | null; folders: Folder[]; roots: {name: string; path: string}[]};

// Rumi's own folder browser, for systems without a native picker (or when you prefer it).
export function FolderBrowser({
  start,
  onChoose,
  onClose,
  onError,
}: {
  start?: string;
  onChoose: (f: Folder) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [list, setList] = useState<Listing | null>(null);
  const [path, setPath] = useState(start || '');
  const go = (p?: string) =>
    api<Listing>(`/folders/list${p ? `?path=${encodeURIComponent(p)}` : ''}`).then(l => {
      setList(l);
      setPath(l.path);
    }, onError);
  useEffect(() => {
    go(start);
  }, []);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="dialog" role="dialog" aria-label="Choose a folder">
        <h2>Choose a folder</h2>
        <div className="browser">
          <form
            className="browser-path"
            onSubmit={e => {
              e.preventDefault();
              go(path);
            }}
          >
            <input value={path} onChange={e => setPath(e.target.value)} aria-label="Folder path" />
            <button className="ghost">Go</button>
          </form>
          <div className="browser-roots">
            {list?.parent && (
              <button className="ghost" onClick={() => go(list.parent!)}>
                ↑ Up
              </button>
            )}
            {list?.roots.map(r => (
              <button key={r.path} className="ghost" onClick={() => go(r.path)}>
                {r.name}
              </button>
            ))}
          </div>
          <div className="browser-list" role="listbox" aria-label="Folders">
            {!list && <p className="quiet pad">Loading…</p>}
            {list && !list.folders.length && <p className="quiet pad">No folders inside.</p>}
            {list?.folders.map(f => (
              <button key={f.path} onDoubleClick={() => go(f.path)} onClick={() => go(f.path)} title={f.path}>
                ▣ {f.name} {f.isRepo && <span className="badge">repo</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!list} onClick={() => list && onChoose({path: list.path, name: list.name, isRepo: list.isRepo})}>
            Open {list?.name || 'folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
