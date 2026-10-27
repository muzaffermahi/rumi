import {useEffect, useRef, useState} from 'react';
import {api, since, statusOf, waitingOnUser, type DocMeta, type Settings, type Task, type Update, type Workspace} from './api';
import {FolderChooser} from './FolderChooser';
import {ProjectPanel} from './ProjectPanel';
import {Icon} from './Icon';

type Props = {
  tasks: Task[];
  openId: string;
  onOpen: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
  settings: Settings | null;
  connected: boolean;
  onError: (e: unknown) => void;
  fresh: string;
  update: Update | null;
  updated?: boolean;
  workspace: Workspace | null;
  workspaces: Workspace[];
  onSwitch: (id: string) => void;
  onOpenFolder: (path: string) => void;
  docId: string;
  onDoc: (id: string) => void;
  onNewDoc: () => void;
  onImport: (file: File) => void;
  onSettings: (section?: string) => void;
};

const FILTERS: Record<string, (t: Task) => boolean> = {
  active: t => !t.archived,
  waiting: t => !t.archived && (waitingOnUser(t) || !!t.suggestion),
  running: t => !t.archived && ['running', 'queued'].includes(t.status),
  done: t => !t.archived && t.status === 'finished',
  archived: t => t.archived,
};

export function Sidebar(p: Props) {
  const {tasks, collapsed, workspace, settings} = p;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [scope, setScope] = useState<'doc' | 'all'>(() => (localStorage.getItem('rumi.taskScope') as 'doc' | 'all') || 'doc');
  const [showArchived, setShowArchived] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const docs = workspace?.docs || [];
  const running = tasks.filter(t => t.status === 'running').length;
  const waiting = tasks.filter(t => !t.archived && waitingOnUser(t)).length;
  const q = query.trim().toLowerCase();
  const shown = tasks.filter(
    t =>
      FILTERS[filter](t) &&
      (scope === 'all' || !t.docId || t.docId === p.docId) &&
      (!q || `${t.title} ${t.objective} ${t.handback?.summary || ''}`.toLowerCase().includes(q)),
  );
  const countFor = (d: DocMeta) => tasks.filter(t => t.docId === d.id && !t.archived && (waitingOnUser(t) || t.suggestion)).length;

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Documents and tasks">
      <div className="side-head">
        {!collapsed && <span className="brand">rumi</span>}
        <button
          className="ghost icon"
          onClick={p.onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} />
        </button>
      </div>
      {!collapsed && (
        <div className="workspace">
          <FolderChooser
            folder={workspace?.path ? {path: workspace.path, name: workspace.name, isRepo: workspace.isRepo} : null}
            recent={p.workspaces.filter(w => w.path).map(w => ({path: w.path!, name: w.name, isRepo: w.isRepo}))}
            onChange={f => (f ? p.onOpenFolder(f.path) : p.onSwitch('global'))}
            onError={p.onError}
          />
          {workspace && settings && <ProjectPanel workspace={workspace} settings={settings} onError={p.onError} />}
        </div>
      )}
      <div className="side-scroll">
        {!collapsed && (
          <div className="side-section">
            <div className="side-title">
              Documents
              <span>
                <button className="ghost" onClick={() => fileInput.current?.click()} title="Import Markdown, HTML or text" aria-label="Import a document">
                  <Icon name="import" />
                </button>
                <button className="ghost" onClick={p.onNewDoc} title="New document" aria-label="New document">
                  <Icon name="plus" />
                </button>
              </span>
            </div>
            {docs
              .filter(d => !d.archived)
              .map(d => (
                <DocRow key={d.id} doc={d} open={d.id === p.docId} count={countFor(d)} wid={workspace!.id} onOpen={p.onDoc} onError={p.onError} />
              ))}
            {!docs.filter(d => !d.archived).length && (
              <p className="quiet" style={{padding: '2px 9px'}}>
                No documents yet.
              </p>
            )}
            {docs.some(d => d.archived) && (
              <>
                <button className="archived-toggle" onClick={() => setShowArchived(s => !s)}>
                  {showArchived ? '▾' : '▸'} Archived · {docs.filter(d => d.archived).length}
                </button>
                {showArchived &&
                  docs
                    .filter(d => d.archived)
                    .map(d => <DocRow key={d.id} doc={d} open={d.id === p.docId} count={0} wid={workspace!.id} onOpen={p.onDoc} onError={p.onError} />)}
              </>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt,.html,.htm"
              hidden
              onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) p.onImport(f);
              }}
            />
          </div>
        )}
        <div className="side-section">
          {!collapsed && (
            <>
              <div className="side-title">Tasks</div>
              <div className="task-tools">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
                <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Show tasks">
                  <option value="active">All</option>
                  <option value="waiting">For you</option>
                  <option value="running">Working</option>
                  <option value="done">Done</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="task-tools">
                <div className="seg" role="radiogroup" aria-label="Which tasks">
                  {(['doc', 'all'] as const).map(s => (
                    <button
                      key={s}
                      role="radio"
                      aria-checked={scope === s}
                      className={scope === s ? 'on' : ''}
                      onClick={() => {
                        setScope(s);
                        localStorage.setItem('rumi.taskScope', s);
                      }}
                    >
                      {s === 'doc' ? 'This document' : 'All documents'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="task-list">
            {!shown.length && !collapsed && (
              <p className="quiet" style={{padding: '4px 9px'}}>
                {tasks.length ? 'No tasks match.' : 'Select a passage and press Delegate. Tasks appear here while you keep writing.'}
              </p>
            )}
            {shown.map(t => (
              <button
                key={t.id}
                className={`task-row${p.openId === t.id ? ' open' : ''}${p.fresh === t.id ? ' fresh' : ''}`}
                onClick={() => p.onOpen(t.id)}
                title={`${t.title} — ${statusOf(t)}`}
              >
                <span className={`dot ${waitingOnUser(t) ? 'needs-you' : t.status}`} />
                {!collapsed && (
                  <span className="row-text">
                    <span className="row-title">{t.title}</span>
                    <span className="quiet">
                      {statusOf(t)} · {t.kind} · {since(t.created)}
                      {t.suggestion && ' · suggestion'}
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      {p.updated && (
        <button className="update-pill" onClick={() => location.reload()} title="Rumi was updated. Reload this page to use the new version.">
          {collapsed ? 'Reload' : 'Rumi was updated · Reload'}
        </button>
      )}
      {!collapsed && !p.updated && p.update && (
        <button className="update-pill" onClick={() => p.onSettings('about')}>
          Rumi {p.update.latest} is available
        </button>
      )}
      <div className="side-foot">
        <button className="ghost" onClick={() => p.onSettings()} aria-label="Settings" title="Settings">
          <Icon name="settings" />
          {!collapsed && ' Settings'}
        </button>
        {!collapsed && (
          <span className="quiet" aria-live="polite">
            {waiting ? (
              <b className="needs">
                {waiting} need{waiting === 1 ? 's' : ''} you
              </b>
            ) : running ? (
              `${running} working`
            ) : (
              ''
            )}
            <span className={`dot ${p.connected ? 'finished' : 'failed'}`} title={p.connected ? 'Connected' : 'Reconnecting'} />
          </span>
        )}
      </div>
    </nav>
  );
}

function DocRow({
  doc,
  open,
  count,
  wid,
  onOpen,
  onError,
}: {
  doc: DocMeta;
  open: boolean;
  count: number;
  wid: string;
  onOpen: (id: string) => void;
  onError: (e: unknown) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(doc.title);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);
  const patch = (body: object) => api(`/w/${wid}/docs/${doc.id}`, 'PATCH', body).catch(onError);
  if (renaming)
    return (
      <form
        onSubmit={e => {
          e.preventDefault();
          patch({title: name});
          setRenaming(false);
        }}
      >
        <input
          className="rename"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => {
            patch({title: name});
            setRenaming(false);
          }}
          onKeyDown={e => e.key === 'Escape' && setRenaming(false)}
          aria-label="Document name"
        />
      </form>
    );
  return (
    <div className="doc-row-wrap" ref={box}>
      <button
        className={`doc-row${open ? ' open' : ''}`}
        onClick={() => onOpen(doc.id)}
        onDoubleClick={() => {
          setName(doc.title);
          setRenaming(true);
        }}
        aria-current={open ? 'page' : undefined}
      >
        <span className="doc-icon" aria-hidden>
          <Icon name="doc" size={14} />
        </span>
        <span className="doc-name">{doc.title}</span>
        {count > 0 && <span className="doc-count needs">{count}</span>}
      </button>
      <button className="ghost doc-more" aria-label={`More for ${doc.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
        ⋯
      </button>
      {menu && (
        <div className="menu" role="menu" style={{right: 0, top: 30}} onClick={() => setMenu(false)}>
          <button
            role="menuitem"
            onClick={() => {
              setName(doc.title);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button role="menuitem" onClick={() => patch({archived: !doc.archived})}>
            {doc.archived ? 'Unarchive' : 'Archive'}
          </button>
          <a role="menuitem" href={`/api/w/${wid}/docs/${doc.id}/export?format=md&download`}>
            Download Markdown
          </a>
          <hr />
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              if (confirm(`Delete “${doc.title}”? Its tasks are archived. This cannot be undone.`)) api(`/w/${wid}/docs/${doc.id}`, 'DELETE').catch(onError);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
