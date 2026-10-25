import React, {useState} from 'react';
import {api, since, statusLabel, type Task, type Model, type Settings, type Workspace} from './api';
import {FolderChooser} from './FolderChooser';

function SettingsPanel({settings, models, connected, onClose, onError}: {settings: Settings; models: Model[]; connected: boolean; onClose: () => void; onError: (m: string) => void}) {
  const save = (body: Partial<Settings>) => api('/settings', 'PUT', body).catch(e => onError(e.message));
  const known = models.some(m => m.ref === settings.defaultModel);
  return <div className="settings" role="dialog" aria-label="Settings">
    <div className="settings-head"><b>Settings</b><button className="ghost close" onClick={onClose} aria-label="Close settings">×</button></div>
    <label>Default model for new tasks
      <select value={settings.defaultModel} onChange={e => save({defaultModel: e.target.value})}>
        {!known && <option value={settings.defaultModel}>{settings.defaultModel} (unavailable)</option>}
        {models.map(m => <option key={m.ref} value={m.ref}>{m.ref}</option>)}
      </select>
    </label>
    <label>Tasks running at once
      <select value={settings.maxWorkers} onChange={e => save({maxWorkers: Number(e.target.value)})}>
        <option value={1}>1 — best for local models</option>
        <option value={2}>2</option>
      </select>
    </label>
    {settings.maxWorkers > 1 && <label>Two tasks in the same project
      <select value={settings.sameFolder ? 'yes' : 'no'} onChange={e => save({sameFolder: e.target.value === 'yes'})}>
        <option value="no">One at a time — safer when they edit files</option>
        <option value="yes">Side by side — fine for research and writing</option>
      </select>
    </label>}
    <p>Models and credentials come from Pi's own configuration. A task keeps the model it started with.</p>
    <p>Each project folder you open is its own workspace: its document, tasks, agent conversations and outputs are kept in <code>.rumi/</code> inside that folder (ignored by git unless you change it). The Global workspace lives in Rumi's <code>data/</code> folder.</p>
    <p>Workers run on this computer with file and PowerShell access; a task folder is a working location, not a sandbox.</p>
    <p className="quiet"><span className={'dot ' + (connected ? 'finished' : 'failed')}/> {connected ? 'Connected to the local Rumi server' : 'Reconnecting…'}</p>
  </div>;
}

type Props = {tasks: Task[]; openId: string; onOpen: (id: string) => void; collapsed: boolean; onToggle: () => void; onNew: () => void;
  settings: Settings | null; models: Model[]; connected: boolean; onError: (m: string) => void; fresh: string;
  workspace: Workspace | null; workspaces: Workspace[]; onSwitch: (id: string) => void; onOpenFolder: (path: string) => void};

export function Sidebar({tasks, openId, onOpen, collapsed, onToggle, onNew, settings, models, connected, onError, fresh, workspace, workspaces, onSwitch, onOpenFolder}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const running = tasks.filter(t => t.status === 'running').length;
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
    </div>}
    {!collapsed && <button className="new-task" onClick={onNew}>+ New task</button>}
    <div className="task-list">
      {!tasks.length && !collapsed && <p className="quiet pad">Select a passage and press Delegate. Tasks appear here while you keep writing.</p>}
      {tasks.map(t => <button key={t.id} className={'task-row' + (openId === t.id ? ' open' : '') + (fresh === t.id ? ' fresh' : '')} onClick={() => onOpen(t.id)} title={`${t.title} — ${statusLabel[t.status] || t.status}`}>
        <span className={'dot ' + t.status}/>
        {!collapsed && <span className="row-text"><span className="row-title">{t.title}</span><span className="quiet">{statusLabel[t.status] || t.status} · {since(t.created)}{!t.documentWide && ' · linked'}</span></span>}
      </button>)}
    </div>
    <div className="side-foot">
      <button className="ghost" onClick={() => setShowSettings(s => !s)} aria-label="Settings" title="Settings">⚙{!collapsed && ' Settings'}</button>
      {!collapsed && <span className="quiet">{running ? `${running} working` : ''}<span className={'dot ' + (connected ? 'finished' : 'failed')} title={connected ? 'Connected' : 'Reconnecting'}/></span>}
    </div>
    {showSettings && settings && <SettingsPanel settings={settings} models={models} connected={connected} onClose={() => setShowSettings(false)} onError={onError}/>}
  </nav>;
}
