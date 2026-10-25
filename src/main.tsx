import React, {useState, useEffect, useRef, useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {useEditor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {api, type Task, type Model, type Settings, type Workspace, type Kinds} from './api';
import {DocumentPane, plainText, type DelegateRequest} from './DocumentPane';
import {TaskPane} from './TaskPane';
import {Sidebar} from './Sidebar';
import {Markdown} from './Markdown';
import {TaskLink, afterPassage} from './taskLink';
import {Connect} from './Connect';
import './style.css';

const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const narrowQuery = window.matchMedia('(max-width: 899px)');

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [openId, setOpenId] = useState('');
  const [collapsed, setCollapsed] = useState(stored('rumi.sidebar') === 'collapsed');
  const [narrow, setNarrow] = useState(narrowQuery.matches);
  const [view, setView] = useState<'doc' | 'tasks'>('doc');
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState('');
  const [fresh, setFresh] = useState('');
  const [openSignal, setOpenSignal] = useState(0);
  // The workspace (global, or a project folder) whose document and tasks are shown.
  const [wid, setWid] = useState(stored('rumi.workspace') || 'global');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [kinds, setKinds] = useState<Kinds>({});
  const [ready, setReady] = useState(true);       // a model is connected and chosen
  const [showModels, setShowModels] = useState(false);
  const docWid = useRef('');   // workspace the editor's content belongs to; saves always go there
  const saveTimer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saveRef = useRef<() => Promise<unknown>>(() => saving.current);

  const editor = useEditor({
    extensions: [StarterKit.configure({link: {openOnClick: false}}), TaskLink],
    content: '',
    editable: false,
    onUpdate: ({editor}) => {
      setEmpty(editor.isEmpty);
      setSaveStatus('Editing…');
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveRef.current(), 500);
    },
  });

  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    if (!editor || !docWid.current) return saving.current;
    const body = {html: editor.getHTML(), text: plainText(editor)}, target = docWid.current;
    saving.current = saving.current.then(() => api(`/w/${target}/document`, 'PUT', body)).then(() => setSaveStatus('Saved'))
      .catch(e => { setError(e.message); setSaveStatus('Save failed'); });
    return saving.current;
  }, [editor]);
  saveRef.current = saveNow;

  // Load the workspace's document; any unsaved edit is first saved to the workspace it came from.
  useEffect(() => {
    if (!editor) return;
    let live = true;
    (async () => {
      if (saveTimer.current) await saveNow(); else await saving.current;
      editor.setEditable(false, false);
      try {
        const d = await api(`/w/${wid}/document`);
        if (!live) return;
        docWid.current = wid;
        editor.commands.setContent(d.html || '', {emitUpdate: false});
        editor.setEditable(true, false);
        setEmpty(editor.isEmpty);
        setSaveStatus('Saved');
      } catch (e: any) { if (live) { setError(e.message); setWid('global'); } }
    })();
    return () => { live = false; };
  }, [editor, wid]);

  useEffect(() => {
    if (!editor) return;
    // Send an unsaved edit even if the tab is closing.
    const flush = () => { if (saveTimer.current && docWid.current) fetch(`/api/w/${docWid.current}/document`, {method: 'PUT', keepalive: true, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({html: editor.getHTML(), text: plainText(editor)})}); };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [editor]);

  useEffect(() => {
    store('rumi.workspace', wid);
    const events = new EventSource(`/api/events?w=${encodeURIComponent(wid)}`);
    events.onmessage = e => {
      const s = JSON.parse(e.data);
      if (s.workspace.id !== wid) { setWid(s.workspace.id); return; } // that workspace is gone; the server fell back
      setTasks(s.tasks); setSettings(s.settings); setWorkspace(s.workspace); setWorkspaces(s.workspaces); setKinds(s.kinds); setReady(s.ready); setConnected(true);
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, [wid]);

  // The model list changes when something is connected or the default changes.
  useEffect(() => { api('/models').then(m => setModels(m.models)).catch(e => setError(e.message)); }, [ready, settings?.defaultModel, showModels]);
  useEffect(() => {
    // `rumi` in a terminal opens /?folder=<that folder>: switch to that folder's workspace.
    const fromTerminal = new URLSearchParams(location.search).get('folder');
    if (fromTerminal) { history.replaceState(null, '', location.pathname); openFolder(fromTerminal); }
    const onResize = () => setNarrow(narrowQuery.matches);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function switchTo(id: string) { if (id === wid) return; setOpenId(''); setTasks([]); setWid(id); }
  async function openFolder(path: string) {
    try {
      const r = await api('/workspaces/open', 'POST', {path});
      switchTo(r.workspace.id);
      setNotice(`Opened ${r.workspace.name}`); setTimeout(() => setNotice(n => n === `Opened ${r.workspace.name}` ? '' : n), 3500);
    } catch (e: any) { setError(e.message); }
  }

  const onDelegate = useCallback(async (r: DelegateRequest) => {
    try {
      setError('');
      await saveNow();
      const t = await api(`/w/${docWid.current || wid}/tasks`, 'POST', r);
      setFresh(t.id);
      setNotice(`Delegated: ${t.title}`);
      setTimeout(() => setNotice(n => n === `Delegated: ${t.title}` ? '' : n), 3500);
      return t.id as string;
    } catch (e: any) { setError(e.message); return null; }
  }, [saveNow, wid]);

  // A result goes under the passage its task is linked to; otherwise after the paragraph with the caret.
  const insert = useCallback((markdown: string, taskId?: string) => {
    if (!editor) return;
    const html = renderToStaticMarkup(<Markdown text={markdown}/>);
    let at = taskId ? afterPassage(editor, taskId) : null;
    if (at === null) {
      const $to = editor.state.doc.resolve(editor.state.selection.to);
      at = $to.depth >= 1 ? $to.after(1) : editor.state.doc.content.size;
    }
    editor.chain().insertContentAt(at, html).focus().scrollIntoView().run();
    if (narrow) setView('doc');
  }, [editor, narrow]);

  const open = useCallback((id: string) => { setOpenId(id); if (narrow) setView('tasks'); }, [narrow]);
  const task = tasks.find(t => t.id === openId);
  const toggle = () => setCollapsed(c => { store('rumi.sidebar', c ? 'open' : 'collapsed'); return !c; });
  const showDoc = !narrow || view === 'doc';
  const showList = !narrow || (view === 'tasks' && !task);
  const showTask = task && (!narrow || view === 'tasks');
  const working = tasks.filter(t => t.status === 'running').length;

  return <div className={'app' + (narrow ? ' narrow' : '') + (collapsed && !narrow ? ' side-collapsed' : '') + (task && !narrow ? ' with-task' : '')}>
    {narrow && <div className="topbar">
      <span className="brand">rumi <small className="topbar-ws">{workspace?.name}</small></span>
      <div className="switch" role="tablist">
        <button role="tab" aria-selected={view === 'doc'} onClick={() => setView('doc')}>Document</button>
        <button role="tab" aria-selected={view === 'tasks'} onClick={() => setView('tasks')}>Tasks{tasks.length ? ` · ${tasks.length}` : ''}{working ? ' •' : ''}</button>
      </div>
    </div>}
    {showList && <Sidebar tasks={tasks} openId={openId} onOpen={open} collapsed={collapsed && !narrow} onToggle={toggle}
      onNew={() => { setView('doc'); setOpenSignal(n => n + 1); }} settings={settings} models={models} connected={connected} onError={setError} fresh={fresh}
      workspace={workspace} workspaces={workspaces} onSwitch={switchTo} onOpenFolder={openFolder} onModels={() => setShowModels(true)}/>}
    <div className={'doc-wrap' + (showDoc ? '' : ' away')} aria-hidden={!showDoc}>
      <DocumentPane editor={editor} empty={empty} saveStatus={saveStatus} models={models} defaultModel={settings?.defaultModel || ''} openSignal={openSignal} onDelegate={onDelegate} onError={setError}
        workspaceName={workspace?.name || ''} tasks={tasks} onOpenTask={open} onInsertNear={insert} kinds={kinds} lastKind={settings?.lastKind || 'research'} hasFolder={!!workspace?.path}/>
    </div>
    {showTask && <TaskPane key={task.id} task={task} back={narrow} onClose={() => setOpenId('')} onInsert={md => insert(md, task.documentWide ? undefined : task.id)} onError={setError}/>}
    {(showModels || (settings && !ready)) && <Connect firstRun={!ready} onClose={() => setShowModels(false)} onError={setError}/>}
    {(error || notice) && <div className={'toast' + (error ? ' bad' : '')} role={error ? 'alert' : 'status'}>
      {error || notice}<button className="ghost" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss">×</button>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
