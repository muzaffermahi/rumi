import React, {useLayoutEffect, useState} from 'react';
import type {Editor} from '@tiptap/react';
import {api, statusOf, waitingOnUser, type Task} from './api';
import {linkedRanges, sameText} from './taskLink';
import {Markdown} from './Markdown';
import {HandbackView} from './Handback';
import {Ask} from './Ask';

type Placed = {task: Task; top: number; bottom: number; changed: boolean; text: string};
type Card = {id: string; type: 'suggestion' | 'ask'} | null;

// Beside each delegated passage: the task's status, whether the passage changed since it was sent, a question
// the worker is waiting on, and the hand-back as a suggestion to insert under the passage or dismiss.
export function Margin({editor, tasks, canvas, tick, onOpenTask, onInsert, onError}: {
  editor: Editor; tasks: Task[]; canvas: HTMLDivElement | null; tick: number;
  onOpenTask: (id: string) => void; onInsert: (markdown: string, taskId: string) => void; onError: (m: string) => void;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [wide, setWide] = useState(true);
  const [card, setCard] = useState<Card>(null);

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
      const a = editor.view.coordsAtPos(r.from), b = editor.view.coordsAtPos(r.to);
      out.push({task: t, top: a.top - box.top, bottom: b.bottom - box.top, text: r.text, changed: !!t.passage && !sameText(r.text, t.passage)});
    }
    out.sort((x, y) => x.top - y.top);
    let next = -Infinity; // keep badges from overlapping
    for (const p of out) { p.top = Math.max(p.top, next); next = p.top + (extraRow(p) ? 58 : 30); }
    setPlaced(out);
  }, [editor, tasks, canvas, tick]);

  // A card whose reason went away (answered, dismissed) closes by itself.
  const cardTask = card && tasks.find(t => t.id === card.id);
  const open = card && cardTask && (card.type === 'ask' ? waitingOnUser(cardTask) : !!cardTask.suggestion) ? card : null;
  const toggle = (id: string, type: 'suggestion' | 'ask') => setCard(c => c?.id === id && c.type === type ? null : {id, type});
  const openTask = (id: string) => { setCard(null); onOpenTask(id); };

  async function send(p: Placed) {
    try { await api(`/tasks/${p.task.id}/passage`, 'POST', {text: p.text}); } catch (e: any) { onError(e.message); }
  }
  async function settle(t: Task, state: 'accepted' | 'dismissed') {
    if (state === 'accepted' && t.suggestion) onInsert(t.suggestion.text, t.id);
    setCard(null);
    try { await api(`/tasks/${t.id}/suggestion`, 'POST', {state}); } catch (e: any) { onError(e.message); }
  }
  async function restart(t: Task) {
    try { await api(`/tasks/${t.id}/restart`, 'POST'); } catch (e: any) { onError(e.message); }
  }

  return <>
    {placed.map(p => {
      const t = p.task, waiting = waitingOnUser(t);
      const flag = p.changed ? '!' : waiting ? '?' : t.suggestion ? '1' : '';
      return <div key={t.id} className={'mark-badge ' + t.status + (wide ? '' : ' compact') + (p.changed ? ' changed' : '') + (waiting ? ' waiting' : '')} style={{top: p.top}}>
        <button className="mark-main" onClick={() => onOpenTask(t.id)} title={`${t.title} — open conversation`}>
          <span className={'dot ' + (waiting ? 'needs-you' : t.status)}/>{wide && <><span className="mark-title">{t.handback?.summary || t.title}</span><span className="mark-status">{statusOf(t)}</span></>}
        </button>
        {wide && p.changed && <div className="mark-row"><span>changed since delegated</span><button onClick={() => send(p)}>Send new version</button></div>}
        {wide && !p.changed && waiting && <div className="mark-row ask-row"><button onClick={() => toggle(t.id, 'ask')}>Answer its question</button></div>}
        {wide && !p.changed && !waiting && t.stalled && <div className="mark-row"><span>no progress</span><button onClick={() => restart(t)}>Restart step</button></div>}
        {wide && !p.changed && !waiting && !t.stalled && t.suggestion && <div className="mark-row"><button onClick={() => toggle(t.id, 'suggestion')}>1 suggestion</button></div>}
        {!wide && flag && <button className="mark-flag" onClick={() => p.changed ? send(p) : toggle(t.id, waiting ? 'ask' : 'suggestion')}
          title={p.changed ? 'Changed since delegated — send the new version' : waiting ? 'Needs you' : '1 suggestion'}>{flag}</button>}
      </div>;
    })}
    {open && placed.filter(p => p.task.id === open.id).map(p => {
      const t = p.task;
      if (open.type === 'ask') return <div key={'ask' + t.id} className="suggestion asking" style={{top: p.bottom + 8}} role="dialog" aria-label={`Question from ${t.title}`}>
        <div className="suggestion-head"><span className="dot needs-you"/> {t.title} <span className="quiet">needs you</span></div>
        <Ask task={t} onError={onError} autoFocus/>
        <div className="suggestion-actions"><button className="ghost" onClick={() => openTask(t.id)}>Open conversation</button></div>
      </div>;
      const s = t.suggestion!;
      return <div key={'card' + t.id} className="suggestion" style={{top: p.bottom + 8}} role="dialog" aria-label={`Suggestion from ${t.title}`}>
        <div className="suggestion-head"><span className={'dot ' + t.status}/> {s.summary || t.title}</div>
        {t.handback && !s.raw
          ? <HandbackView handback={t.handback} taskId={t.id} files={t.files} clip/>
          : <><div className="suggestion-body md"><Markdown text={s.text} taskId={t.id} files={t.files}/></div>
              <p className="quiet raw-note">The worker didn't hand back a finished answer, so this is its last reply.</p></>}
        <div className="suggestion-actions">
          <button className="primary" onClick={() => settle(t, 'accepted')}>Insert below the passage</button>
          <button className="ghost" onClick={() => settle(t, 'dismissed')}>Dismiss</button>
          <button className="ghost" onClick={() => openTask(t.id)}>Open conversation</button>
        </div>
      </div>;
    })}
  </>;
}

const extraRow = (p: Placed) => p.changed || !!p.task.suggestion || waitingOnUser(p.task) || p.task.stalled;
