import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {api, cost, duration, fileUrl, since, statusOf, tokens, waitingOnUser, type Handback, type Model, type Queued, type Question, type Task} from './api';
import {Markdown} from './Markdown';
import {Working} from './Working';
import {HandbackView} from './Handback';
import {Ask} from './Ask';
import {Changes} from './Changes';
import {ModelPicker} from './ModelPicker';
import {useToasts} from './Toasts';

type Item = {
  role: 'user' | 'assistant' | 'note';
  kind?: string;
  text: string;
  passage?: string | null;
  context?: boolean;
  tools?: {name: string; args: string; result?: string; isError?: boolean}[];
  offers?: Offer[];
  error?: string;
  aborted?: boolean;
  model?: string;
  legacy?: boolean;
  handback?: Handback;
  question?: Question;
  taskKind?: string;
  brief?: boolean;
};
type Offer = {file: string; title?: string};
type Reading = Offer & {text?: string};
type Supplied = {at: string; kind: string; revision: number; shortened: boolean; length?: number; text: string; note?: string};
type Conversation = {id: string; version: number; objective: string; source: string; items: Item[]; contexts: Supplied[]};

function UserMessage({item, queued}: {item: Item | Queued; queued?: string}) {
  if (item.kind === 'research-check') return <div className="event">{item.text}</div>;
  if (item.kind === 'context') return <div className="event">Document context updated{queued && ` · ${queued.toLowerCase()}`}</div>;
  return (
    <div className={`msg user${queued ? ' queued' : ''}`}>
      {queued && <span className="tag">{queued}</span>}
      {item.passage && <blockquote>{item.passage}</blockquote>}
      {item.text && <p>{item.text}</p>}
      {item.context && <span className="ctx-chip">{item.kind === 'delegation' ? 'with document background' : 'with updated document'}</span>}
      {'brief' in item && item.brief && <span className="ctx-chip">with the project's README</span>}
    </div>
  );
}

function Copy({text}: {text: string}) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function Reply({item, task, onInsert, onOpen}: {item: Item; task: Task; onInsert: (md: string) => void; onOpen: (o: Offer) => void}) {
  // A reply that handed back shows the hand-back; the worker's closing line after finish is left out.
  const chat = item.handback ? '' : item.text;
  return (
    <div className="msg agent">
      {chat && (
        <div className="md">
          <Markdown text={chat} taskId={task.id} files={task.files} />
        </div>
      )}
      {item.handback && (
        <div className="handback-card">
          <div className="handback-head">
            Handed back
            {item.handback.summary && (
              <>
                {' '}
                · <span>{item.handback.summary}</span>
              </>
            )}
          </div>
          <HandbackView handback={item.handback} taskId={task.id} files={task.files} />
          <div className="msg-actions">
            <button className="link-btn" onClick={() => onInsert(item.handback!.answer)}>
              Insert into document
            </button>
            <Copy text={item.handback.answer} />
          </div>
        </div>
      )}
      {item.question && (
        <div className="asked">
          <span className="tag">Asked you</span>
          <p>{item.question.question}</p>
        </div>
      )}
      {!!item.tools?.length && (
        <details className="tools">
          <summary>
            {item.tools.length} tool {item.tools.length === 1 ? 'call' : 'calls'} · {[...new Set(item.tools.map(t => t.name))].join(', ')}
          </summary>
          {item.tools.map((t, i) => (
            <div key={i} className={`tool${t.isError ? ' bad' : ''}`}>
              <b>{t.name}</b> <code>{t.args}</code>
              {t.result !== undefined && <pre>{t.result}</pre>}
            </div>
          ))}
        </details>
      )}
      {item.offers?.map(o => (
        <div key={o.file} className="offer">
          <span className="offer-name">
            <b>{o.title || o.file}</b>
            {o.title && o.title !== o.file && <small>{o.file}</small>}
          </span>
          <button className="ghost" onClick={() => onOpen(o)}>
            Open it here
          </button>
        </div>
      ))}
      {item.error && <div className="msg-error">{item.error}</div>}
      {item.aborted && !item.text && <div className="event">Stopped</div>}
      {chat && !item.question && (
        <div className="msg-actions">
          <button className="link-btn" onClick={() => onInsert(chat)}>
            Insert into document
          </button>
          <Copy text={chat} />
        </div>
      )}
    </div>
  );
}

type Props = {
  task: Task;
  group: Task[];
  models: Model[];
  back?: boolean;
  onClose: () => void;
  onInsert: (md: string) => void;
  onOpen: (id: string) => void;
  onRerun: (model: string) => void;
  onDeleted: () => void;
};

export function TaskPane({task, group, models, back, onClose, onInsert, onOpen, onRerun, onDeleted}: Props) {
  const toast = useToasts();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [text, setText] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const [tab, setTab] = useState<'conversation' | 'changes' | 'compare'>('conversation');
  const [menu, setMenu] = useState(false);
  const [rerun, setRerun] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const convScroll = useRef(0);
  const stick = useRef(true);
  const lastLive = useRef('');
  if (task.live) lastLive.current = task.live;
  const hasChanges = !!task.changes || !!task.worktree;
  const compare = group.length > 1;

  useEffect(() => {
    setConv(null);
    stick.current = true;
    lastLive.current = '';
    setText('');
    setTab('conversation');
  }, [task.id]);
  useEffect(() => {
    let live = true;
    api<Conversation>(`/tasks/${task.id}`).then(c => live && setConv(c), toast.error);
    return () => {
      live = false;
    };
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
      const body = await r.text();
      setReading(cur => (cur?.file === o.file ? {...o, text: body} : cur));
    } catch (e) {
      toast.error(e);
      setReading(null);
    }
  }
  function closeDoc() {
    stick.current = false;
    setReading(null);
    requestAnimationFrame(() => {
      if (scroller.current) scroller.current.scrollTop = convScroll.current;
    });
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    }
  }
  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    stick.current = true;
    try {
      await api(`/tasks/${task.id}/messages`, 'POST', {text: t});
    } catch (e) {
      toast.error(e);
      setText(t);
    }
  }
  async function remove() {
    if (!confirm(`Delete “${task.title}”, its conversation and its files? This cannot be undone.`)) return;
    await act(async () => {
      await api(`/tasks/${task.id}`, 'DELETE');
      onDeleted();
    });
  }

  const running = task.status === 'running';
  const waiting = running || task.status === 'queued';
  // Keep the last streamed text on screen until the persisted message has been fetched.
  const live = task.live || (running && conv && conv.version < task.version ? lastLive.current : '');
  const queueLabel = waiting ? 'Queued' : 'Not sent';
  const meta = [
    task.model,
    task.elapsed ? duration(task.elapsed) : '',
    task.usage?.total ? `${tokens(task.usage.total)} tokens` : '',
    task.usage?.cost ? cost(task.usage.cost) : '',
  ].filter(Boolean);

  return (
    <section className="task-pane" aria-label="Task conversation">
      <header className="task-head">
        {back && (
          <button className="ghost" onClick={onClose}>
            ← Back
          </button>
        )}
        <div className="task-title">
          <h2 title={task.title}>{task.title}</h2>
          <div className="quiet">
            <span className={`dot ${waitingOnUser(task) ? 'needs-you' : task.status}`} /> {statusOf(task)} · <span className="kind-chip">{task.kind}</span>
            {task.projectDir && (
              <>
                {' '}
                · <span title={task.projectDir}>▣ {task.projectDir.split(/[\\/]/).pop()}</span>
              </>
            )}
            {task.archived && ' · archived'}
          </div>
        </div>
        {waiting && (
          <button className="ghost danger" onClick={() => act(() => api(`/tasks/${task.id}/stop`, 'POST'))}>
            Stop
          </button>
        )}
        {task.stalled && (
          <button className="ghost" title="Abort the current step and start it again" onClick={() => act(() => api(`/tasks/${task.id}/restart`, 'POST'))}>
            Restart step
          </button>
        )}
        {['interrupted', 'failed', 'cancelled'].includes(task.status) && (
          <button className="ghost" onClick={() => act(() => api(`/tasks/${task.id}/resume`, 'POST'))}>
            Resume
          </button>
        )}
        <div className="bar-menu">
          <button className="ghost" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="menu" role="menu" style={{right: 0, top: 'calc(100% + 4px)'}} onMouseLeave={() => setMenu(false)}>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setRerun(true);
                }}
              >
                Run again on another model…
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  act(() => api(`/tasks/${task.id}`, 'PATCH', {archived: !task.archived}));
                }}
              >
                {task.archived ? 'Unarchive' : 'Archive'}
              </button>
              {task.handback?.answer && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    navigator.clipboard.writeText(task.handback!.answer);
                    toast.notify('Answer copied');
                  }}
                >
                  Copy the answer
                </button>
              )}
              <hr />
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(false);
                  remove();
                }}
              >
                Delete task
              </button>
            </div>
          )}
        </div>
        {!back && (
          <button className="ghost close" onClick={onClose} aria-label="Close task">
            ×
          </button>
        )}
      </header>
      {rerun && (
        <div className="task-meta" style={{alignItems: 'center'}}>
          <span>Run the same request on:</span>
          <div style={{flex: 1, minWidth: 160}}>
            <ModelPicker
              models={models.filter(m => m.ref !== task.model)}
              value=""
              onChange={ref => {
                setRerun(false);
                if (ref) onRerun(ref);
              }}
              label="Model to run again on"
            />
          </div>
          <button className="ghost" onClick={() => setRerun(false)}>
            Cancel
          </button>
        </div>
      )}
      {!!meta.length && (
        <div className="task-meta">
          {meta.map(m => (
            <span key={m}>{m}</span>
          ))}
          {task.finishedAt && <span>finished {since(task.finishedAt)}</span>}
        </div>
      )}
      {(hasChanges || compare) && (
        <div className="task-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'conversation'} onClick={() => setTab('conversation')}>
            Conversation
          </button>
          {hasChanges && (
            <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
              Changes{task.changes?.reverted ? ' · reverted' : ''}
            </button>
          )}
          {compare && (
            <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')}>
              Compare · {group.length}
            </button>
          )}
        </div>
      )}
      {tab === 'changes' && <Changes task={task} />}
      {tab === 'compare' && (
        <div className="compare">
          {group.map(t => (
            <div key={t.id} className="compare-col">
              <h4>
                <span className={`dot ${t.status}`} /> {t.model}
              </h4>
              <span className="quiet">
                {statusOf(t)}
                {t.elapsed ? ` · ${duration(t.elapsed)}` : ''}
                {t.usage?.cost ? ` · ${cost(t.usage.cost)}` : ''}
              </span>
              <div className="md">
                {t.handback?.answer || t.suggestion?.text ? (
                  <Markdown text={t.handback?.answer || t.suggestion!.text} taskId={t.id} files={t.files} />
                ) : (
                  <p className="quiet">No answer yet.</p>
                )}
              </div>
              <div className="msg-actions">
                {(t.handback?.answer || t.suggestion?.text) && (
                  <button className="link-btn" onClick={() => onInsert(t.handback?.answer || t.suggestion!.text)}>
                    Insert into document
                  </button>
                )}
                {t.id !== task.id && (
                  <button className="link-btn" onClick={() => onOpen(t.id)}>
                    Open
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'conversation' && (
        <>
          {reading && (
            <div className="reader" aria-label={`Document ${reading.file}`}>
              <div className="reader-bar">
                <button className="ghost" onClick={closeDoc}>
                  ← Conversation
                </button>
                <span className="quiet">{reading.file}</span>
                {reading.text && (
                  <button className="ghost" onClick={() => onInsert(reading.text!)}>
                    Insert
                  </button>
                )}
                <a className="ghost" href={fileUrl(task.id, reading.file)} title="Download">
                  ↓
                </a>
              </div>
              <div className="reader-body md">
                {reading.text === undefined ? <p className="quiet">Opening…</p> : <Markdown text={reading.text} taskId={task.id} files={task.files} />}
              </div>
            </div>
          )}
          <div
            className="conv"
            hidden={!!reading}
            ref={scroller}
            onScroll={e => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {!conv && <div className="quiet pad">Opening…</div>}
            {conv?.items.map((item, i) =>
              item.role === 'user' ? (
                <UserMessage key={i} item={item} />
              ) : item.role === 'note' ? (
                <div key={i} className={`event${item.kind === 'check' ? ' check' : ''}`}>
                  {item.text}
                </div>
              ) : (
                <Reply key={i} item={item} task={task} onInsert={onInsert} onOpen={openDoc} />
              ),
            )}
            {live && (
              <div className="msg agent streaming">
                <div className="md">
                  <Markdown text={live} />
                </div>
              </div>
            )}
            {running && <Working activity={task.activity} tool={task.activeTool} />}
            {task.stalled && (
              <div className="stalled">
                No progress for a while; the model or a tool may be stuck.{' '}
                <button className="link-btn" onClick={() => act(() => api(`/tasks/${task.id}/restart`, 'POST'))}>
                  Restart this step
                </button>{' '}
                or keep waiting.
              </div>
            )}
            {task.notice && <div className="event">{task.notice.message}</div>}
            {waitingOnUser(task) && (
              <div className="ask-panel">
                <span className="tag">Needs you</span>
                <Ask key={task.dialog?.id || task.question?.question} task={task} onError={toast.error} />
              </div>
            )}
            {!!task.warnings?.length && <div className="msg-error">Some extensions had problems: {task.warnings.join('; ')}</div>}
            {task.queued.map((q, i) => (
              <UserMessage key={`q${i}`} item={q} queued={queueLabel} />
            ))}
            {task.error && <div className="msg-error">{task.error}</div>}
            {!!task.files.length && (
              <div className="files">
                <span className="quiet">Output files</span>
                {task.files.map(f => (
                  <span key={f} className="file">
                    <a href={fileUrl(task.id, f, true)} target="_blank" rel="noreferrer">
                      {f}
                    </a>
                    {/\.(md|txt)$/i.test(f) && (
                      <button
                        title="Insert this file into the document"
                        onClick={() =>
                          act(async () => {
                            const r = await fetch(fileUrl(task.id, f, true));
                            if (!r.ok) throw Error(`Could not read ${f}`);
                            onInsert(await r.text());
                          })
                        }
                      >
                        Insert
                      </button>
                    )}
                    <a href={fileUrl(task.id, f)} aria-label={`Download ${f}`} title="Download">
                      ↓
                    </a>
                  </span>
                ))}
              </div>
            )}
            {conv && !!conv.contexts.length && (
              <details className="supplied">
                <summary>Context supplied · {conv.contexts.length}</summary>
                {conv.contexts.map((c, i) => (
                  <div key={i} className="supplied-item">
                    <div className="quiet">
                      {c.kind === 'delegation' ? 'At delegation' : 'Context update'} · {since(c.at)} · document revision {c.revision ?? '—'} ·{' '}
                      {c.shortened
                        ? `shortened (${c.text.length.toLocaleString()} of ${(c.length || 0).toLocaleString()} characters)`
                        : `full document, ${c.text.length.toLocaleString()} characters`}
                    </div>
                    {c.note && <div className="quiet">{c.note}</div>}
                    <pre>{c.text}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
          <footer className="composer">
            {task.pendingContext && <div className="ctx-note">The updated document will be sent with your next message.</div>}
            <textarea
              aria-label="Message"
              rows={2}
              value={text}
              placeholder={
                running
                  ? 'Steer this task… (delivered after its current step)'
                  : task.status === 'needs-you'
                    ? 'Answer, or say anything else…'
                    : 'Continue the conversation…'
              }
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-row">
              <button
                className="ghost"
                title="Send the current document to this task as background"
                onClick={() => act(() => api(`/tasks/${task.id}/context`, 'POST'))}
              >
                Update document context
              </button>
              <button className="primary" disabled={!text.trim()} onClick={send}>
                {running ? 'Steer' : 'Send'}
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
