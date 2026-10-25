import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {api, fileUrl, since, statusLabel, type Task, type Queued} from './api';
import {Markdown} from './Markdown';
import {Working} from './Working';

type Item = {role: 'user' | 'assistant' | 'note'; kind?: string; text: string; passage?: string | null; context?: boolean;
  tools?: {name: string; args: string; result?: string; isError?: boolean}[]; offers?: Offer[]; error?: string; aborted?: boolean; model?: string; legacy?: boolean};
type Offer = {file: string; title?: string};
type Reading = Offer & {text?: string};
type Supplied = {at: string; kind: string; revision: number; shortened: boolean; length?: number; text: string; note?: string};
type Conversation = {id: string; version: number; objective: string; source: string; items: Item[]; contexts: Supplied[]};

function UserMessage({item, queued}: {item: Item | Queued; queued?: string}) {
  if (item.kind === 'research-check') return <div className="event">{item.text}</div>;
  if (item.kind === 'context') return <div className="event">Document context updated{queued && ` · ${queued.toLowerCase()}`}</div>;
  return <div className={'msg user' + (queued ? ' queued' : '')}>
    {queued && <span className="tag">{queued}</span>}
    {item.passage && <blockquote>{item.passage}</blockquote>}
    {item.text && <p>{item.text}</p>}
    {item.context && <span className="ctx-chip">{item.kind === 'delegation' ? 'with document background' : 'with updated document'}</span>}
  </div>;
}

function Reply({item, task, onInsert, onOpen}: {item: Item; task: Task; onInsert: (md: string) => void; onOpen: (o: Offer) => void}) {
  return <div className="msg agent">
    {item.text && <div className="md"><Markdown text={item.text} taskId={task.id} files={task.files}/></div>}
    {!!item.tools?.length && <details className="tools"><summary>{item.tools.length} tool {item.tools.length === 1 ? 'call' : 'calls'} · {[...new Set(item.tools.map(t => t.name))].join(', ')}</summary>
      {item.tools.map((t, i) => <div key={i} className={'tool' + (t.isError ? ' bad' : '')}><b>{t.name}</b> <code>{t.args}</code>{t.result !== undefined && <pre>{t.result}</pre>}</div>)}
    </details>}
    {item.offers?.map(o => <div key={o.file} className="offer">
      <span className="offer-name"><b>{o.title || o.file}</b>{o.title && o.title !== o.file && <small>{o.file}</small>}</span>
      <button className="ghost" onClick={() => onOpen(o)}>Open it in this conversation</button>
    </div>)}
    {item.error && <div className="msg-error">{item.error}</div>}
    {item.aborted && !item.text && <div className="event">Stopped</div>}
    {item.text && <button className="link-btn" onClick={() => onInsert(item.text)}>Insert into document</button>}
  </div>;
}

export function TaskPane({task, onClose, onInsert, onError, back}: {task: Task; onClose: () => void; onInsert: (md: string) => void; onError: (m: string) => void; back?: boolean}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [text, setText] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const convScroll = useRef(0);
  const stick = useRef(true);
  const lastLive = useRef('');
  if (task.live) lastLive.current = task.live;

  useEffect(() => { setConv(null); stick.current = true; lastLive.current = ''; setText(''); }, [task.id]);
  useEffect(() => {
    let live = true;
    api(`/tasks/${task.id}`).then(c => { if (live) setConv(c); }).catch(e => onError(e.message));
    return () => { live = false; };
  }, [task.id, task.version]);

  // Follow new content only when the reader is already at the bottom; scroll only this pane.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && !reading && stick.current) el.scrollTop = el.scrollHeight;
  });

  // Documents the worker offered open here, in the side panel only, never in the main document.
  async function openDoc(o: Offer) {
    convScroll.current = scroller.current?.scrollTop || 0;
    setReading(o);
    try {
      const r = await fetch(fileUrl(task.id, o.file, true));
      if (!r.ok) throw Error(`${o.file} is no longer in the task folder.`);
      const text = await r.text();
      setReading(cur => cur?.file === o.file ? {...o, text} : cur);
    } catch (e: any) { onError(e.message); setReading(null); }
  }
  function closeDoc() {
    stick.current = false;
    setReading(null);
    requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = convScroll.current; });
  }

  async function act(fn: () => Promise<unknown>) { try { await fn(); } catch (e: any) { onError(e.message); } }
  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    stick.current = true;
    try { await api(`/tasks/${task.id}/messages`, 'POST', {text: t}); } catch (e: any) { onError(e.message); setText(t); }
  }

  const running = task.status === 'running';
  const waiting = running || task.status === 'queued';
  // Keep the last streamed text on screen until the persisted message has been fetched.
  const live = task.live || (running && conv && conv.version < task.version ? lastLive.current : '');
  const queueLabel = waiting ? 'Queued' : 'Not sent';

  return <section className="task-pane" aria-label="Task conversation">
    <header className="task-head">
      {back && <button className="ghost" onClick={onClose}>← Tasks</button>}
      <div className="task-title">
        <h2 title={task.title}>{task.title}</h2>
        <div className="quiet"><span className={'dot ' + task.status}/> {statusLabel[task.status] || task.status} · {task.model}{task.projectDir && <> · <span title={task.projectDir}>▣ {task.projectDir.split(/[\\/]/).pop()}</span></>}</div>
      </div>
      {waiting && <button className="ghost danger" onClick={() => act(() => api(`/tasks/${task.id}/stop`, 'POST'))}>Stop</button>}
      {['interrupted', 'failed'].includes(task.status) && <button className="ghost" onClick={() => act(() => api(`/tasks/${task.id}/resume`, 'POST'))}>Resume</button>}
      {!back && <button className="ghost close" onClick={onClose} aria-label="Close task">×</button>}
    </header>
    {reading && <div className="reader" aria-label={`Document ${reading.file}`}>
      <div className="reader-bar">
        <button className="ghost" onClick={closeDoc}>← Conversation</button>
        <span className="quiet">{reading.file}</span>
        <a className="ghost" href={fileUrl(task.id, reading.file)} title="Download">↓</a>
      </div>
      <div className="reader-body md">{reading.text === undefined ? <p className="quiet">Opening…</p> : <Markdown text={reading.text} taskId={task.id} files={task.files}/>}</div>
    </div>}
    <div className="conv" hidden={!!reading} ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {!conv && <div className="quiet pad">Opening…</div>}
      {conv?.items.map((item, i) => item.role === 'user' ? <UserMessage key={i} item={item}/>
        : item.role === 'note' ? <div key={i} className="event">{item.text}</div>
        : <Reply key={i} item={item} task={task} onInsert={onInsert} onOpen={openDoc}/>)}
      {live && <div className="msg agent streaming"><div className="md"><Markdown text={live}/></div></div>}
      {running && <Working activity={task.activity} tool={task.activeTool}/>}
      {task.queued.map((q, i) => <UserMessage key={'q' + i} item={q} queued={queueLabel}/>)}
      {task.error && <div className="msg-error">{task.error}</div>}
      {!!task.files.length && <div className="files"><span className="quiet">Output files</span>
        {task.files.map(f => <span key={f} className="file"><a href={fileUrl(task.id, f, true)} target="_blank" rel="noreferrer">{f}</a>
          {/\.(md|txt)$/i.test(f) && <button title="Insert this file into the document" onClick={() => act(async () => { const r = await fetch(fileUrl(task.id, f, true)); if (!r.ok) throw Error(`Could not read ${f}`); onInsert(await r.text()); })}>Insert</button>}
          <a href={fileUrl(task.id, f)} aria-label={`Download ${f}`} title="Download">↓</a></span>)}
      </div>}
      {conv && !!conv.contexts.length && <details className="supplied"><summary>Context supplied · {conv.contexts.length}</summary>
        {conv.contexts.map((c, i) => <div key={i} className="supplied-item">
          <div className="quiet">{c.kind === 'delegation' ? 'At delegation' : 'Context update'} · {since(c.at)} · document revision {c.revision ?? '—'} · {c.shortened ? `shortened (${c.text.length.toLocaleString()} of ${(c.length || 0).toLocaleString() || '?'} characters)` : `full document, ${c.text.length.toLocaleString()} characters`}</div>
          {c.note && <div className="quiet">{c.note}</div>}
          <pre>{c.text}</pre>
        </div>)}
      </details>}
    </div>
    <footer className="composer">
      {task.pendingContext && <div className="ctx-note">Updated document will be sent with your next message.</div>}
      <textarea aria-label="Message" rows={2} value={text} placeholder={running ? 'Steer this task… (delivered after its current step)' : 'Continue the conversation…'}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}/>
      <div className="composer-row">
        <button className="ghost" title="Send the current document to this task as background" onClick={() => act(() => api(`/tasks/${task.id}/context`, 'POST'))}>Update document context</button>
        <button className="primary" disabled={!text.trim()} onClick={send}>{running ? 'Steer' : 'Send'}</button>
      </div>
    </footer>
  </section>;
}
