import {useLayoutEffect, useRef, useState} from 'react';
import type {Editor} from '@tiptap/react';
import {api, statusOf, waitingOnUser, type Task} from './api';
import {linkedRanges, sameText} from './taskLink';
import {Markdown} from './Markdown';
import {HandbackView} from './Handback';
import {Ask} from './Ask';
import {diffWords, similarity} from './diff';

type Placed = {task: Task; top: number; bottom: number; changed: boolean; text: string};
type Card = {id: string; type: 'suggestion' | 'ask'} | null;

// Beside each delegated passage: the task's status, whether the passage changed since it was sent, a question
// the worker is waiting on, and the hand-back as a suggestion to insert under the passage, put in its place, or dismiss.
export function Margin({
  editor,
  tasks,
  canvas,
  tick,
  onOpenTask,
  onInsert,
  onReplace,
  onError,
}: {
  editor: Editor;
  tasks: Task[];
  canvas: HTMLDivElement | null;
  tick: number;
  onOpenTask: (id: string) => void;
  onInsert: (markdown: string, taskId: string) => void;
  onReplace: (markdown: string, taskId: string) => void;
  onError: (e: unknown) => void;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [wide, setWide] = useState(true);
  const [card, setCard] = useState<Card>(null);
  const [view, setView] = useState<'answer' | 'diff'>('answer');
  const body = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!canvas || editor.isDestroyed) return;
    const box = canvas.getBoundingClientRect();
    const scroller = canvas.parentElement!;
    setWide((scroller.clientWidth - box.width) / 2 >= 200);
    const ranges = linkedRanges(editor.state.doc);
    const out: Placed[] = [];
    for (const t of tasks) {
      const r = ranges.get(t.id);
      if (!r) continue;
      const a = editor.view.coordsAtPos(r.from),
        b = editor.view.coordsAtPos(r.to);
      out.push({task: t, top: a.top - box.top, bottom: b.bottom - box.top, text: r.text, changed: !!t.passage && !sameText(r.text, t.passage)});
    }
    out.sort((x, y) => x.top - y.top);
    let next = -Infinity; // keep badges from overlapping
    for (const p of out) {
      p.top = Math.max(p.top, next);
      next = p.top + (extraRow(p) ? 58 : 30);
    }
    setPlaced(out);
  }, [editor, tasks, canvas, tick]);

  // A card whose reason went away (answered, dismissed) closes by itself.
  const cardTask = card && tasks.find(t => t.id === card.id);
  const open = card && cardTask && (card.type === 'ask' ? waitingOnUser(cardTask) : !!cardTask.suggestion) ? card : null;
  const toggle = (id: string, type: 'suggestion' | 'ask', t?: Task) => {
    setCard(c => (c?.id === id && c.type === type ? null : {id, type}));
    // A rewrite of the passage opens on its changes; anything else on the answer.
    const p = placed.find(x => x.task.id === id);
    setView(t?.suggestion && p && similarity(p.text, plain(t.suggestion.text)) > 0.35 ? 'diff' : 'answer');
  };
  const openTask = (id: string) => {
    setCard(null);
    onOpenTask(id);
  };

  async function send(p: Placed) {
    try {
      await api(`/tasks/${p.task.id}/passage`, 'POST', {text: p.text});
    } catch (e) {
      onError(e);
    }
  }
  // Only the part of the answer you selected in the card, if any.
  const selectedPart = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !body.current?.contains(sel.anchorNode)) return null;
    return sel.toString().trim() || null;
  };
  async function settle(t: Task, how: 'insert' | 'replace' | 'dismiss') {
    const part = how === 'dismiss' ? null : selectedPart();
    if (how === 'insert' && t.suggestion) onInsert(part || t.suggestion.text, t.id);
    if (how === 'replace' && t.suggestion) onReplace(part || t.suggestion.text, t.id);
    setCard(null);
    // After a replace, the answer is the passage now: it isn't "changed since delegated".
    const passage = how === 'replace' ? linkedRanges(editor.state.doc).get(t.id)?.text : undefined;
    try {
      await api(`/tasks/${t.id}/suggestion`, 'POST', {state: how === 'dismiss' ? 'dismissed' : 'accepted', passage});
    } catch (e) {
      onError(e);
    }
  }
  async function restart(t: Task) {
    try {
      await api(`/tasks/${t.id}/restart`, 'POST');
    } catch (e) {
      onError(e);
    }
  }

  return (
    <>
      {placed.map(p => {
        const t = p.task,
          waiting = waitingOnUser(t);
        const flag = p.changed ? '!' : waiting ? '?' : t.suggestion ? '1' : '';
        return (
          <div
            key={t.id}
            className={`mark-badge ${t.status}${wide ? '' : ' compact'}${p.changed ? ' changed' : ''}${waiting ? ' waiting' : ''}`}
            style={{top: p.top}}
          >
            <button className="mark-main" onClick={() => onOpenTask(t.id)} title={`${t.title} — open conversation`}>
              <span className={`dot ${waiting ? 'needs-you' : t.status}`} />
              {wide && (
                <>
                  <span className="mark-title">{t.handback?.summary || t.title}</span>
                  <span className="mark-status">{statusOf(t)}</span>
                </>
              )}
            </button>
            {wide && p.changed && (
              <div className="mark-row">
                <span>changed since delegated</span>
                <button onClick={() => send(p)}>Send new version</button>
              </div>
            )}
            {wide && !p.changed && waiting && (
              <div className="mark-row">
                <button onClick={() => toggle(t.id, 'ask')}>Answer its question</button>
              </div>
            )}
            {wide && !p.changed && !waiting && t.stalled && (
              <div className="mark-row">
                <span>no progress</span>
                <button onClick={() => restart(t)}>Restart step</button>
              </div>
            )}
            {wide && !p.changed && !waiting && !t.stalled && t.suggestion && (
              <div className="mark-row">
                <button onClick={() => toggle(t.id, 'suggestion', t)}>1 suggestion</button>
              </div>
            )}
            {!wide && flag && (
              <button
                className="mark-flag"
                onClick={() => (p.changed ? send(p) : toggle(t.id, waiting ? 'ask' : 'suggestion', t))}
                title={p.changed ? 'Changed since delegated — send the new version' : waiting ? 'Answer its question' : '1 suggestion'}
                aria-label={p.changed ? 'Send the new version' : waiting ? 'Answer its question' : '1 suggestion'}
              >
                {flag}
              </button>
            )}
          </div>
        );
      })}
      {open &&
        placed
          .filter(p => p.task.id === open.id)
          .map(p => {
            const t = p.task;
            if (open.type === 'ask')
              return (
                <div key={`ask${t.id}`} className="answer-card asking" style={{top: p.bottom + 8}} role="dialog" aria-label={`Question from ${t.title}`}>
                  <div className="suggestion-head">
                    <span className="dot needs-you" /> {t.title} <span className="quiet">needs you</span>
                  </div>
                  <Ask task={t} onError={onError} autoFocus />
                  <div className="suggestion-actions">
                    <button className="ghost" onClick={() => openTask(t.id)}>
                      Open conversation
                    </button>
                  </div>
                </div>
              );
            const s = t.suggestion!;
            return (
              <div
                key={`card${t.id}`}
                className="answer-card"
                style={{top: p.bottom + 8}}
                role="dialog"
                aria-label={`Suggestion from ${t.title}`}
                onKeyDown={e => e.key === 'Escape' && setCard(null)}
              >
                <div className="suggestion-head">
                  <span className={`dot ${t.status}`} /> <span className="grow">{s.summary || t.title}</span>
                  <div className="seg" role="tablist" aria-label="Show">
                    <button role="tab" aria-selected={view === 'answer'} className={view === 'answer' ? 'on' : ''} onClick={() => setView('answer')}>
                      Answer
                    </button>
                    <button role="tab" aria-selected={view === 'diff'} className={view === 'diff' ? 'on' : ''} onClick={() => setView('diff')}>
                      Changes
                    </button>
                  </div>
                </div>
                <div ref={body}>
                  {view === 'diff' ? (
                    <div className="diff" aria-label="Changes from your passage">
                      {diffWords(p.text, plain(s.text)).map((part, i) =>
                        part.type === 'add' ? (
                          <ins key={i}>{part.text}</ins>
                        ) : part.type === 'del' ? (
                          <del key={i}>{part.text}</del>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </div>
                  ) : t.handback && !s.raw ? (
                    <HandbackView handback={t.handback} taskId={t.id} files={t.files} clip />
                  ) : (
                    <>
                      <div className="suggestion-body md">
                        <Markdown text={s.text} taskId={t.id} files={t.files} />
                      </div>
                      <p className="quiet raw-note">The worker didn't hand back a finished answer, so this is its last reply.</p>
                    </>
                  )}
                </div>
                <div className="suggestion-actions">
                  <button className="primary" onClick={() => settle(t, 'insert')}>
                    Insert below
                  </button>
                  <button className="secondary" onClick={() => settle(t, 'replace')} title="Put the answer in place of your passage">
                    Replace passage
                  </button>
                  <button className="ghost" onClick={() => settle(t, 'dismiss')}>
                    Dismiss
                  </button>
                  <button className="ghost" onClick={() => openTask(t.id)}>
                    Conversation
                  </button>
                  <span className="hint">Select part of it to use only that</span>
                </div>
              </div>
            );
          })}
    </>
  );
}

const extraRow = (p: Placed) => p.changed || !!p.task.suggestion || waitingOnUser(p.task) || p.task.stalled;
// Markdown without its markup, for comparing with the passage.
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__|\*|_|`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .trim();
