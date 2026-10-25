import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {marked} from 'marked';
import {useEditor} from '@tiptap/react';
import {api, Conflict, whenLocked, type DocMeta, type Model, type Snapshot, type Task} from './api';
import {DocumentPane, plainText, type DelegateRequest} from './DocumentPane';
import {TaskPane} from './TaskPane';
import {Sidebar} from './Sidebar';
import {afterPassage, linkedRanges, linkPassage, replacePassage} from './taskLink';
import {extensions} from './editor/extensions';
import {useToasts} from './Toasts';
import {matches, typing} from './keys';
import {trackTasks} from './notify';
import {CommandPalette, type Command} from './CommandPalette';
import {Coach, Locked, ShortcutSheet} from './Overlays';
import type {Section} from './Settings';

// Rarely opened screens load on demand, keeping the first load small.
const Settings = lazy(() => import('./Settings').then(m => ({default: m.Settings})));
const Connect = lazy(() => import('./Connect').then(m => ({default: m.Connect})));

const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const narrowQuery = window.matchMedia('(max-width: 899px)');
const DEFAULT_KEYS = {delegate: 'Mod+Enter', palette: 'Mod+K', newDocument: 'Mod+Alt+N', focusMode: 'Mod+Shift+F', shortcuts: 'Shift+?'};

export function App() {
  const toast = useToasts();
  const [locked, setLocked] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(true);
  const [models, setModels] = useState<Model[]>([]);
  const [wid, setWid] = useState(stored('rumi.workspace') || 'global');
  const [docId, setDocId] = useState('');
  const [openId, setOpenId] = useState('');
  const [collapsed, setCollapsed] = useState(stored('rumi.sidebar') === 'collapsed');
  const [narrow, setNarrow] = useState(narrowQuery.matches);
  const [view, setView] = useState<'doc' | 'tasks'>('doc');
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [saveFailed, setSaveFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [words, setWords] = useState(0);
  const [fresh, setFresh] = useState('');
  const [openSignal, setOpenSignal] = useState(0);
  const [settingsAt, setSettingsAt] = useState<Section | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [focus, setFocus] = useState(false);
  useEffect(() => whenLocked(() => setLocked(true)), []);

  const tasks = snap?.tasks || [];
  const settings = snap?.settings || null;
  const workspace = snap?.workspace || null;
  const docs = workspace?.docs || [];
  const keys = {...DEFAULT_KEYS, ...settings?.shortcuts};

  // --- live updates for the workspace on screen ---
  useEffect(() => {
    store('rumi.workspace', wid);
    const events = new EventSource(`/api/events?w=${encodeURIComponent(wid)}`);
    events.onmessage = e => {
      const s: Snapshot = JSON.parse(e.data);
      if (s.workspace.id !== wid) return setWid(s.workspace.id); // that workspace is gone; the server fell back
      setSnap(s);
      setConnected(true);
    };
    events.onerror = () => {
      setConnected(false);
      fetch('/api/workspaces').then(
        r => r.status === 401 && setLocked(true),
        () => {},
      );
    };
    return () => events.close();
  }, [wid]);

  useEffect(() => {
    api<{models: Model[]}>('/models').then(
      m => setModels(m.models),
      () => {},
    );
  }, [snap?.ready, settings?.defaultModel, showConnect]);

  // Theme: the setting wins; "system" follows the computer. Remembered locally so the next load paints right away.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    store('rumi.theme', settings.theme);
  }, [settings?.theme]);

  // The document on screen: the one you had open in this workspace, else the first one.
  useEffect(() => {
    if (!workspace) return;
    if (docId && docs.some(d => d.id === docId)) return;
    const remembered = stored(`rumi.doc.${workspace.id}`);
    const next = docs.find(d => d.id === remembered) || docs.find(d => !d.archived);
    setDocId(next?.id || '');
  }, [workspace?.id, docs.map(d => d.id).join()]);
  useEffect(() => {
    if (docId && workspace) store(`rumi.doc.${workspace.id}`, docId);
  }, [docId]);

  // --- the editor and saving ---
  const target = useRef<{wid: string; docId: string} | null>(null); // where the editor's content belongs; saves go there
  const revision = useRef(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saveRef = useRef<(force?: boolean) => Promise<unknown>>(() => saving.current);
  const titleNext = useRef(false);
  const primed = useRef(''); // a document just made here, already shown empty
  const widRef = useRef(wid);
  widRef.current = wid;
  const upload = useCallback(async (f: File) => {
    if (f.size > 15 * 1024 * 1024) throw Error('Images can be up to 15 MB.');
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    return (await api<{url: string}>(`/w/${target.current?.wid || widRef.current}/assets`, 'POST', {name: f.name, type: f.type, data})).url;
  }, []);

  const editor = useEditor({
    extensions: extensions({upload}),
    content: '',
    editable: false,
    onUpdate: ({editor}) => {
      setWords(editor.storage.characterCount.words());
      setSaveStatus('Editing…');
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveRef.current(), 600);
    },
  });

  const saveNow = useCallback(
    (force = false) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      const t = target.current;
      if (!editor || !t) return saving.current;
      const body = {html: editor.getHTML(), text: plainText(editor), baseRevision: revision.current, force};
      saving.current = saving.current
        .then(() => api<{revision: number}>(`/w/${t.wid}/docs/${t.docId}`, 'PUT', body))
        .then(r => {
          if (target.current === t) revision.current = r.revision;
          setSaveStatus('Saved');
          setSaveFailed(false);
          setConflict(false);
        })
        .catch(e => {
          if (e instanceof Conflict) {
            setConflict(true);
            setSaveStatus('Not saved');
          } else {
            setSaveStatus('Save failed');
            setSaveFailed(true);
            toast.error(e);
          }
        });
      return saving.current;
    },
    [editor],
  );
  saveRef.current = saveNow;

  const loadDoc = useCallback(async () => {
    if (!editor) return;
    if (primed.current && primed.current === docId) {
      primed.current = '';
      setWords(0);
      setSaveStatus('Saved');
      setSaveFailed(false);
      setConflict(false);
      return;
    }
    if (saveTimer.current) await saveNow();
    else await saving.current;
    editor.setEditable(false, false);
    if (!docId) {
      target.current = null;
      editor.commands.setContent('', {emitUpdate: false});
      return;
    }
    try {
      const d = await api<DocMeta & {html: string; revision: number}>(`/w/${wid}/docs/${docId}`);
      target.current = {wid, docId};
      revision.current = d.revision;
      editor.commands.setContent(d.html || '', {emitUpdate: false});
      editor.setEditable(true, false);
      // A document you just made opens with its title selected, ready to name.
      if (titleNext.current) {
        titleNext.current = false;
        requestAnimationFrame(() => {
          // Only if you haven't already named it and moved on: never pull focus out of the text you are writing.
          const title = document.querySelector('.doc-title') as HTMLInputElement | null;
          const idle = document.activeElement === document.body || document.activeElement === title;
          if (title && idle && title.value === 'Untitled') title.select();
        });
      }
      setWords(editor.storage.characterCount.words());
      setSaveStatus('Saved');
      setSaveFailed(false);
      setConflict(false);
    } catch (e) {
      toast.error(e);
    }
  }, [editor, wid, docId]);
  useEffect(() => {
    loadDoc();
  }, [loadDoc]);

  // Send an unsaved edit even if the tab is closing.
  useEffect(() => {
    if (!editor) return;
    const flush = () => {
      const t = target.current;
      if (!saveTimer.current || !t) return;
      fetch(`/api/w/${t.wid}/docs/${t.docId}`, {
        method: 'PUT',
        keepalive: true,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({html: editor.getHTML(), text: plainText(editor), baseRevision: revision.current}),
      });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [editor]);

  async function resolveConflict(keep: 'mine' | 'theirs') {
    if (keep === 'mine') await saveNow(true);
    else {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      await loadDoc();
    }
  }

  // --- workspaces and documents ---
  function switchTo(id: string) {
    if (id === wid) return;
    setOpenId('');
    setSnap(s => (s ? {...s, tasks: []} : s));
    setDocId('');
    setWid(id);
  }
  async function openFolder(path: string) {
    try {
      const r = await api(`/workspaces/open`, 'POST', {path});
      switchTo(r.workspace.id);
      toast.notify(`Opened ${r.workspace.name}`);
    } catch (e) {
      toast.error(e);
    }
  }
  useEffect(() => {
    // `rumi` in a terminal opens /?folder=<that folder>; `rumi setup` opens /?connect=1.
    const params = new URLSearchParams(location.search);
    const folder = params.get('folder');
    if (params.get('connect')) setShowConnect(true);
    if (folder || params.get('connect')) history.replaceState(null, '', location.pathname);
    if (folder) openFolder(folder);
    const onResize = () => setNarrow(narrowQuery.matches);
    narrowQuery.addEventListener('change', onResize);
    return () => narrowQuery.removeEventListener('change', onResize);
  }, []);

  // A new document is shown at once, before the next live update lists it.
  const addDoc = (meta: DocMeta) => {
    setSnap(s => (s ? {...s, workspace: {...s.workspace, docs: [meta, ...(s.workspace.docs || []).filter(d => d.id !== meta.id)]}} : s));
    setDocId(meta.id);
    if (narrow) setView('doc');
  };
  async function newDoc(title = 'Untitled') {
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      if (saveTimer.current) await saveNow();
      else await saving.current;
      const meta = await api<DocMeta>(`/w/${wid}/docs`, 'POST', {title});
      // A new document is empty, so it is ready to write in at once, without loading it first.
      if (editor) {
        target.current = {wid, docId: meta.id};
        revision.current = 0;
        editor.commands.setContent('', {emitUpdate: false});
        editor.setEditable(true, false);
        primed.current = meta.id;
      }
      titleNext.current = true;
      addDoc(meta);
    } catch (e) {
      toast.error(e);
    }
  }
  async function importDoc(file: File) {
    try {
      const meta = await api<DocMeta>(`/w/${wid}/docs/import`, 'POST', {name: file.name, content: await file.text()});
      addDoc(meta);
      toast.notify(`Imported ${meta.title}`);
    } catch (e) {
      toast.error(e);
    }
  }
  const renameTimer = useRef<number | undefined>(undefined);
  const rename = useCallback(
    (title: string) => {
      clearTimeout(renameTimer.current);
      const id = docId;
      renameTimer.current = window.setTimeout(() => api(`/w/${wid}/docs/${id}`, 'PATCH', {title}).catch(toast.error), 500);
    },
    [wid, docId],
  );
  async function deleteDoc() {
    const d = docs.find(x => x.id === docId);
    if (!d || !confirm(`Delete “${d.title}”? Its tasks are archived. This cannot be undone.`)) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    target.current = null;
    try {
      await api(`/w/${wid}/docs/${docId}`, 'DELETE');
      setDocId(docs.find(x => x.id !== docId && !x.archived)?.id || '');
    } catch (e) {
      toast.error(e);
    }
  }
  async function exportDoc(format: 'md' | 'html' | 'txt' | 'print' | 'copy') {
    await saveNow();
    if (format === 'print') return window.print();
    if (format === 'copy') {
      try {
        const r = await fetch(`/api/w/${wid}/docs/${docId}/export?format=md`);
        await navigator.clipboard.writeText(await r.text());
        toast.notify('Copied as Markdown');
      } catch (e) {
        toast.error(e);
      }
      return;
    }
    const a = document.createElement('a');
    a.href = `/api/w/${wid}/docs/${docId}/export?format=${format}&download`;
    a.click();
  }

  // --- delegating and using answers ---
  const onDelegate = useCallback(
    async (r: DelegateRequest) => {
      try {
        await saveNow();
        const t = await api<Task>(`/w/${target.current?.wid || wid}/tasks`, 'POST', {...r, docId: target.current?.docId || docId});
        setFresh(t.id);
        toast.notify(`Delegated: ${t.title}`);
        return t.id;
      } catch (e) {
        toast.error(e);
        return null;
      }
    },
    [saveNow, wid, docId],
  );

  // Rumi keeps the version before it changes your document, and the change itself is one undo step.
  const beforeChange = (title: string) => {
    const t = target.current;
    if (t) api(`/w/${t.wid}/docs/${t.docId}/snapshot`, 'POST', {label: `Before: ${title}`.slice(0, 120)}).catch(() => {});
  };
  const undoToast = (text: string) => toast.notify(text, {action: {label: 'Undo', run: () => editor?.commands.undo()}});
  // Markdown to the editor's HTML; the editor keeps only what its schema knows, so raw HTML in an answer is dropped.
  const htmlOf = (markdown: string) => marked.parse(markdown, {gfm: true, async: false});

  // A result goes under the passage its task is linked to; otherwise after the paragraph with the caret.
  const insert = useCallback(
    (markdown: string, taskId?: string) => {
      if (!editor) return;
      beforeChange(`inserting ${tasks.find(t => t.id === taskId)?.title || 'an answer'}`);
      let at = taskId ? afterPassage(editor, taskId) : null;
      if (at === null) {
        const $to = editor.state.doc.resolve(editor.state.selection.to);
        at = $to.depth >= 1 ? $to.after(1) : editor.state.doc.content.size;
      }
      editor.chain().insertContentAt(at, htmlOf(markdown)).focus().scrollIntoView().run();
      if (narrow) setView('doc');
      undoToast('Inserted into your document');
    },
    [editor, narrow, tasks],
  );
  const replace = useCallback(
    (markdown: string, taskId: string) => {
      if (!editor) return;
      beforeChange(`replacing a passage with ${tasks.find(t => t.id === taskId)?.title || 'an answer'}`);
      if (!replacePassage(editor, taskId, htmlOf(markdown))) return insert(markdown, taskId);
      if (narrow) setView('doc');
      undoToast('Replaced the passage');
    },
    [editor, narrow, tasks, insert],
  );

  async function rerun(task: Task, model: string) {
    try {
      const t = await api<Task>(`/tasks/${task.id}/rerun`, 'POST', {model});
      const range = editor && linkedRanges(editor.state.doc).get(task.id);
      if (editor && range) linkPassage(editor, range.from, range.to, t.id);
      setFresh(t.id);
      setOpenId(t.id);
      toast.notify(`Running again on ${model}`);
    } catch (e) {
      toast.error(e);
    }
  }

  const open = useCallback(
    (id: string) => {
      setOpenId(id);
      if (narrow) setView('tasks');
      const t = tasks.find(x => x.id === id);
      if (t?.docId && t.docId !== docId && docs.some(d => d.id === t.docId)) setDocId(t.docId);
    },
    [narrow, tasks, docId, docs],
  );
  const task = tasks.find(t => t.id === openId);

  // --- background awareness: tab title and notifications ---
  useEffect(() => {
    trackTasks(tasks, !!settings?.notifications, open);
  }, [tasks, settings?.notifications]);

  // --- global shortcuts ---
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (matches(e, keys.palette)) {
        e.preventDefault();
        setPalette(p => !p);
      } else if (matches(e, keys.newDocument)) {
        e.preventDefault();
        newDoc();
      } else if (matches(e, keys.focusMode)) {
        e.preventDefault();
        setFocus(f => !f);
      } else if (!typing(e) && matches(e, keys.shortcuts)) {
        e.preventDefault();
        setSheet(true);
      } else if (e.key === 'Escape' && focus && !typing(e)) setFocus(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [keys.palette, keys.newDocument, keys.focusMode, keys.shortcuts, focus, wid]);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [
      {id: 'new-doc', group: 'Commands', label: 'New document', keys: keys.newDocument, run: () => newDoc()},
      {
        id: 'delegate',
        group: 'Commands',
        label: 'Delegate…',
        hint: 'the selection or the whole document',
        keys: keys.delegate,
        run: () => setOpenSignal(n => n + 1),
      },
      {id: 'focus', group: 'Commands', label: focus ? 'Leave focus mode' : 'Focus mode', keys: keys.focusMode, run: () => setFocus(f => !f)},
      {
        id: 'theme',
        group: 'Commands',
        label: 'Switch light / dark',
        run: () =>
          api('/settings', 'PUT', {
            theme:
              document.documentElement.dataset.theme === 'dark' ||
              (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
                ? 'light'
                : 'dark',
          }).catch(toast.error),
      },
      {id: 'models', group: 'Commands', label: 'Models and sign-ins', run: () => setShowConnect(true)},
      {id: 'settings', group: 'Commands', label: 'Settings', run: () => setSettingsAt('models')},
      {id: 'shortcuts', group: 'Commands', label: 'Keyboard shortcuts', keys: keys.shortcuts, run: () => setSheet(true)},
      {id: 'export-md', group: 'Commands', label: 'Download as Markdown', run: () => exportDoc('md')},
      {id: 'copy-md', group: 'Commands', label: 'Copy document as Markdown', run: () => exportDoc('copy')},
      {id: 'print', group: 'Commands', label: 'Print or save as PDF', run: () => exportDoc('print')},
      {id: 'sidebar', group: 'Commands', label: collapsed ? 'Show the sidebar' : 'Hide the sidebar', run: () => toggleSidebar()},
      {id: 'about', group: 'Commands', label: 'About Rumi and checks', run: () => setSettingsAt('about')},
    ];
    for (const d of docs)
      out.push({id: `doc-${d.id}`, group: 'Documents', label: d.title, hint: d.archived ? 'archived' : undefined, run: () => setDocId(d.id)});
    for (const t of tasks.slice(0, 80)) out.push({id: `task-${t.id}`, group: 'Tasks', label: t.title, hint: t.status, run: () => open(t.id)});
    for (const w of snap?.workspaces || [])
      if (w.id !== wid) out.push({id: `ws-${w.id}`, group: 'Workspaces', label: w.name, hint: w.path || 'Global', run: () => switchTo(w.id)});
    return out;
  }, [docs, tasks, snap?.workspaces, wid, focus, collapsed, keys.newDocument, keys.delegate, keys.focusMode, keys.shortcuts]);

  function toggleSidebar() {
    setCollapsed(c => {
      store('rumi.sidebar', c ? 'open' : 'collapsed');
      return !c;
    });
  }

  if (locked) return <Locked />;
  const doc = docs.find(d => d.id === docId) || null;
  const docTasks = tasks.filter(t => !t.docId || t.docId === docId);
  const showDoc = !narrow || view === 'doc';
  const showList = !narrow || (view === 'tasks' && !task);
  const showTask = task && (!narrow || view === 'tasks');
  const working = tasks.filter(t => t.status === 'running').length;
  const coachSteps = [
    {label: 'Connect a model', done: !!snap?.ready},
    {label: 'Select a passage and press Delegate', done: tasks.length > 0},
    {label: 'Open the suggestion in the margin', done: tasks.some(t => t.status === 'finished')},
  ];

  return (
    <div
      className={`app${narrow ? ' narrow' : ''}${collapsed && !narrow ? ' side-collapsed' : ''}${task && !narrow ? ' with-task' : ''}${focus ? ' focus-mode' : ''}`}
    >
      <a className="skip" href="#main">
        Skip to the document
      </a>
      {narrow && (
        <div className="topbar">
          <span className="brand">
            rumi <small className="topbar-ws">{workspace?.name}</small>
          </span>
          <div className="switch" role="tablist">
            <button role="tab" aria-selected={view === 'doc'} onClick={() => setView('doc')}>
              Document
            </button>
            <button role="tab" aria-selected={view === 'tasks'} onClick={() => setView('tasks')}>
              Tasks{tasks.length ? ` · ${tasks.filter(t => !t.archived).length}` : ''}
              {working ? ' •' : ''}
            </button>
          </div>
          <button className="ghost" onClick={() => setPalette(true)} aria-label="Command palette">
            ⌕
          </button>
        </div>
      )}
      {showList && (
        <Sidebar
          tasks={tasks}
          openId={openId}
          onOpen={open}
          collapsed={collapsed && !narrow}
          onToggle={toggleSidebar}
          settings={settings}
          connected={connected}
          onError={toast.error}
          fresh={fresh}
          update={snap?.update || null}
          workspace={workspace}
          workspaces={snap?.workspaces || []}
          onSwitch={switchTo}
          onOpenFolder={openFolder}
          docId={docId}
          onDoc={id => {
            setDocId(id);
            if (narrow) setView('doc');
          }}
          onNewDoc={() => newDoc()}
          onImport={importDoc}
          onSettings={s => setSettingsAt((s as Section) || 'models')}
        />
      )}
      <div className={`doc-wrap${showDoc ? '' : ' away'}`} aria-hidden={!showDoc}>
        {editor && doc ? (
          <DocumentPane
            editor={editor}
            wid={wid}
            doc={doc}
            saveStatus={saveStatus}
            saveFailed={saveFailed}
            words={words}
            models={models}
            defaultModel={settings?.defaultModel || ''}
            openSignal={openSignal}
            onDelegate={onDelegate}
            onError={toast.error}
            tasks={docTasks}
            onOpenTask={open}
            onInsert={insert}
            onReplace={replace}
            kinds={snap?.kinds || {}}
            presets={snap?.presets || []}
            lastKind={settings?.lastKind || 'research'}
            hasFolder={!!workspace?.path}
            delegateKey={keys.delegate}
            focus={focus}
            onFocus={() => setFocus(f => !f)}
            onRename={rename}
            onDelete={deleteDoc}
            onExport={exportDoc}
            conflict={conflict}
            onConflict={resolveConflict}
            onReload={loadDoc}
            upload={upload}
          />
        ) : (
          snap && (
            <div className="doc">
              <div className="empty-docs">
                <h1>Room for a thought.</h1>
                <p>
                  {docs.length
                    ? 'Pick a document in the sidebar, or start a new one.'
                    : `${workspace?.path ? `${workspace.name} has` : 'You have'} no documents yet. Start one, or import a Markdown, HTML or text file.`}
                </p>
                <div className="row">
                  <button className="primary" onClick={() => newDoc()}>
                    New document
                  </button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
      {showTask && (
        <TaskPane
          key={task.id}
          task={task}
          group={tasks.filter(t => t.group === task.group)}
          models={models}
          back={narrow}
          onClose={() => setOpenId('')}
          onInsert={md => insert(md, task.documentWide || task.docId !== docId ? undefined : task.id)}
          onOpen={open}
          onRerun={m => rerun(task, m)}
          onDeleted={() => setOpenId('')}
        />
      )}
      <Suspense fallback={null}>
        {settingsAt && settings && snap && (
          <Settings
            settings={settings}
            models={models}
            version={snap.version}
            update={snap.update}
            section={settingsAt}
            onSection={setSettingsAt}
            onClose={() => setSettingsAt(null)}
            onConnect={() => setShowConnect(true)}
          />
        )}
        {(showConnect || (snap && !snap.ready)) && <Connect firstRun={!snap?.ready} onClose={() => setShowConnect(false)} onError={toast.error} />}
      </Suspense>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {sheet && <ShortcutSheet shortcuts={keys} onClose={() => setSheet(false)} />}
      {snap && snap.ready && !snap.onboarded && !settingsAt && (
        <Coach steps={coachSteps} onDone={() => api('/settings', 'PUT', {onboarded: true}).catch(toast.error)} />
      )}
    </div>
  );
}
