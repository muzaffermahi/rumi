import React, {useEffect, useState} from 'react';
import {api, since, statusOf, waitingOnUser, type Task, type Model, type Settings, type Workspace, type Package} from './api';
import {FolderChooser} from './FolderChooser';

function SettingsPanel({settings, models, connected, onClose, onError, onModels}: {settings: Settings; models: Model[]; connected: boolean; onClose: () => void; onError: (m: string) => void; onModels: () => void}) {
  const save = (body: Partial<Settings>) => api('/settings', 'PUT', body).catch(e => onError(e.message));
  const known = models.some(m => m.ref === settings.defaultModel);
  const [quitting, setQuitting] = useState(false);
  return <div className="settings" role="dialog" aria-label="Settings">
    <div className="settings-head"><b>Settings</b><button className="ghost close" onClick={onClose} aria-label="Close settings">×</button></div>
    <button className="settings-link" onClick={onModels}>Models and sign-ins <span aria-hidden>›</span></button>
    <label>Default model for new tasks
      <select value={settings.defaultModel} onChange={e => save({defaultModel: e.target.value})}>
        {!known && <option value={settings.defaultModel}>{settings.defaultModel || 'none'} (unavailable)</option>}
        {models.map(m => <option key={m.ref} value={m.ref}>{m.ref}</option>)}
      </select>
    </label>
    <label>Tasks running at once
      <select value={settings.maxWorkers} onChange={e => save({maxWorkers: Number(e.target.value)})}>
        <option value={1}>1 — best for local models</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
      </select>
    </label>
    {settings.maxWorkers > 1 && <label>Two tasks in the same project
      <select value={settings.sameFolder ? 'yes' : 'no'} onChange={e => save({sameFolder: e.target.value === 'yes'})}>
        <option value="no">One at a time — safer when they edit files</option>
        <option value="yes">Side by side — fine for research and writing</option>
      </select>
    </label>}
    <label>Reasoning
      <select value={settings.reasoning} onChange={e => save({reasoning: e.target.value as Settings['reasoning']})}>
        <option value="auto">Automatic — more for thinking tasks, less for writing</option>
        <option value="off">Off — faster; for small local models</option>
      </select>
    </label>
    <label className="check"><input type="checkbox" checked={settings.userSkills} onChange={e => save({userSkills: e.target.checked})}/> Offer my own skills (~/.agents/skills) to workers</label>
    <Packages installed={settings.packages} onError={onError}/>
    <p>Workers run on this computer. Research, Write and Think tasks can read and write files in their task folder; Build tasks can also edit project files and run commands.</p>
    <div className="settings-foot">
      <span className="quiet"><span className={'dot ' + (connected ? 'finished' : 'failed')}/> {connected ? 'Connected to Rumi' : 'Reconnecting…'}</span>
      <button className="ghost danger" disabled={quitting} onClick={() => { setQuitting(true); fetch('/api/shutdown', {method: 'POST', headers: {'X-Rumi-UI': '1'}}).catch(() => {}); }}>{quitting ? 'Rumi has stopped' : 'Quit Rumi'}</button>
    </div>
  </div>;
}

// Pi packages (community extensions and skills), installed into Rumi's own Pi home and enabled per workspace.
function Packages({installed, onError}: {installed: Package[]; onError: (m: string) => void}) {
  const [fromPi, setFromPi] = useState<Package[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/packages').then(r => setFromPi(r.fromPi)).catch(() => {}); }, [installed.length]);
  async function add(n: string) {
    setBusy(n);
    try { await api('/packages', 'POST', {name: n}); setName(''); } catch (e: any) { onError(e.message); } finally { setBusy(''); }
  }
  return <div className="packages">
    <div className="packages-head">Pi packages</div>
    <p>Extensions and skills from the Pi community. Rumi keeps its own copy; turn one on for a workspace under <i>This project</i>.</p>
    {installed.map(p => <div key={p.source} className="pkg"><b>{p.name}</b><small>{p.version}</small>
      <button className="ghost" onClick={() => api('/packages', 'DELETE', {source: p.source}).catch(e => onError(e.message))} aria-label={`Remove ${p.name}`}>Remove</button></div>)}
    {fromPi.map(p => <div key={p.source} className="pkg suggested"><b>{p.name}</b><small>in your Pi</small>
      <button className="ghost" disabled={!!busy} onClick={() => add(p.name)}>{busy === p.name ? 'Adding…' : 'Add'}</button></div>)}
    <form className="pkg-add" onSubmit={e => { e.preventDefault(); if (name.trim()) add(name.trim()); }}>
      <input placeholder="Package name, e.g. pi-lens" value={name} onChange={e => setName(e.target.value)} aria-label="Pi package name"/>
      <button className="ghost" disabled={!name.trim() || !!busy}>{busy && busy === name.trim() ? 'Adding…' : 'Add'}</button>
    </form>
  </div>;
}

// What this workspace is about, and which Pi packages its tasks get.
function ProjectPanel({workspace, installed, onError}: {workspace: Workspace; installed: Package[]; onError: (m: string) => void}) {
  const [brief, setBrief] = useState(workspace.brief || '');
  const [saved, setSaved] = useState(true);
  const [open, setOpen] = useState(!workspace.brief);
  useEffect(() => { setBrief(workspace.brief || ''); setSaved(true); setOpen(!workspace.brief); }, [workspace.id]);
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(() => api(`/w/${workspace.id}/brief`, 'PUT', {brief}).then(() => setSaved(true)).catch(e => onError(e.message)), 600);
    return () => clearTimeout(t);
  }, [brief, saved]);
  const enabled = new Set(workspace.packages || []);
  const toggle = (source: string) => {
    const next = enabled.has(source) ? [...enabled].filter(s => s !== source) : [...enabled, source];
    api(`/w/${workspace.id}/packages`, 'PUT', {sources: next}).catch(e => onError(e.message));
  };
  return <details className="project" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary>This project</summary>
    <textarea rows={4} value={brief} placeholder="What is this project, who is it for, what matters? Every task gets this." onChange={e => { setBrief(e.target.value); setSaved(false); }} aria-label="Project brief"/>
    <div className="quiet">{saved ? (workspace.readme ? 'Saved · the folder’s README is included too' : 'Saved') : 'Saving…'}</div>
    {!!installed.length && <div className="project-pkgs">{installed.map(p => <label key={p.source} className="check" title={p.description}>
      <input type="checkbox" checked={enabled.has(p.source)} onChange={() => toggle(p.source)}/> {p.name}</label>)}</div>}
  </details>;
}

type Props = {tasks: Task[]; openId: string; onOpen: (id: string) => void; collapsed: boolean; onToggle: () => void; onNew: () => void;
  settings: Settings | null; models: Model[]; connected: boolean; onError: (m: string) => void; fresh: string;
  workspace: Workspace | null; workspaces: Workspace[]; onSwitch: (id: string) => void; onOpenFolder: (path: string) => void; onModels: () => void};

export function Sidebar({tasks, openId, onOpen, collapsed, onToggle, onNew, settings, models, connected, onError, fresh, workspace, workspaces, onSwitch, onOpenFolder, onModels}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const running = tasks.filter(t => t.status === 'running').length;
  const waiting = tasks.filter(waitingOnUser).length;
  return <nav className={'sidebar' + (collapsed ? ' collapsed' : '')} aria-label="Tasks">
    <div className="side-head">
      {!collapsed && <span className="brand">rumi</span>}
      <button className="ghost icon" onClick={onToggle} aria-label={collapsed ? 'Expand task list' : 'Collapse task list'} title={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? '»' : '«'}</button>
    </div>
    {!collapsed && <div className="workspace">
      <FolderChooser folder={workspace?.path ? {path: workspace.path, name: workspace.name, isRepo: workspace.isRepo} : null}
        recent={workspaces.filter(w => w.path).map(w => ({path: w.path!, name: w.name, isRepo: w.isRepo}))}
        onChange={f => f ? onOpenFolder(f.path) : onSwitch('global')} onError={onError}
        none={{label: 'Global', hint: 'your workspace outside any project', menu: 'Global workspace'}}/>
      {workspace && settings && <ProjectPanel workspace={workspace} installed={settings.packages || []} onError={onError}/>}
    </div>}
    {!collapsed && <button className="new-task" onClick={onNew}>+ New task</button>}
    <div className="task-list">
      {!tasks.length && !collapsed && <p className="quiet pad">Select a passage and press Delegate. Tasks appear here while you keep writing.</p>}
      {tasks.map(t => <button key={t.id} className={'task-row' + (openId === t.id ? ' open' : '') + (fresh === t.id ? ' fresh' : '')} onClick={() => onOpen(t.id)} title={`${t.title} — ${statusOf(t)}`}>
        <span className={'dot ' + (waitingOnUser(t) ? 'needs-you' : t.status)}/>
        {!collapsed && <span className="row-text"><span className="row-title">{t.title}</span><span className="quiet">{statusOf(t)} · {t.kind} · {since(t.created)}{!t.documentWide && ' · linked'}</span></span>}
      </button>)}
    </div>
    <div className="side-foot">
      <button className="ghost" onClick={() => setShowSettings(s => !s)} aria-label="Settings" title="Settings">⚙{!collapsed && ' Settings'}</button>
      {!collapsed && <span className="quiet">{waiting ? <b className="needs">{waiting} need{waiting === 1 ? 's' : ''} you</b> : running ? `${running} working` : ''}<span className={'dot ' + (connected ? 'finished' : 'failed')} title={connected ? 'Connected' : 'Reconnecting'}/></span>}
    </div>
    {showSettings && settings && <SettingsPanel settings={settings} models={models} connected={connected} onClose={() => setShowSettings(false)} onError={onError} onModels={() => { setShowSettings(false); onModels(); }}/>}
  </nav>;
}
