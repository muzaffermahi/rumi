import React, {useLayoutEffect, useState} from 'react';
import type {Editor} from '@tiptap/react';
import {api, statusLabel, type Task} from './api';
import {linkedRanges, sameText} from './taskLink';
import {Markdown} from './Markdown';

type Placed = {task: Task; top: number; bottom: number; changed: boolean; text: string};

// Beside each delegated passage: the task's status, whether the passage changed since it was sent,
// and the task's answer as a suggestion to insert under the passage or dismiss.
export function Margin({editor, tasks, canvas, tick, onOpenTask, onInsert, onError}: {
  editor: Editor; tasks: Task[]; canvas: HTMLDivElement | null; tick: number;
  onOpenTask: (id: string) => void; onInsert: (markdown: string, taskId: string) => void; onError: (m: string) => void;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [wide, setWide] = useState(true);
  const [card, setCard] = useState('');

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
    for (const p of out) { p.top = Math.max(p.top, next); next = p.top + (p.changed || p.task.suggestion ? 58 : 30); }
    setPlaced(out);
  }, [editor, tasks, canvas, tick]);

  async function send(p: Placed) {
    try { await api(`/tasks/${p.task.id}/passage`, 'POST', {text: p.text}); } catch (e: any) { onError(e.message); }
  }
  async function settle(t: Task, state: 'accepted' | 'dismissed') {
    if (state === 'accepted' && t.suggestion) onInsert(t.suggestion.text, t.id);
    setCard('');
    try { await api(`/tasks/${t.id}/suggestion`, 'POST', {state}); } catch (e: any) { onError(e.message); }
  }

  return <>
    {placed.map(p => {
      const t = p.task;
      return <div key={t.id} className={'mark-badge ' + t.status + (wide ? '' : ' compact') + (p.changed ? ' changed' : '')} style={{top: p.top}}>
        <button className="mark-main" onClick={() => onOpenTask(t.id)} title={`${t.title} — open conversation`}>
          <span className={'dot ' + t.status}/>{wide && <><span className="mark-title">{t.title}</span><span className="mark-status">{statusLabel[t.status] || t.status}</span></>}
        </button>
        {wide && p.changed && <div className="mark-row"><span>changed since delegated</span><button onClick={() => send(p)}>Send new version</button></div>}
        {wide && !p.changed && t.suggestion && <div className="mark-row"><button onClick={() => setCard(c => c === t.id ? '' : t.id)}>1 suggestion</button></div>}
        {!wide && (p.changed || t.suggestion) && <button className="mark-flag" onClick={() => p.changed ? send(p) : setCard(c => c === t.id ? '' : t.id)} title={p.changed ? 'Changed since delegated — send the new version' : '1 suggestion'}>{p.changed ? '!' : '1'}</button>}
      </div>;
    })}
    {placed.filter(p => p.task.id === card && p.task.suggestion).map(p => <div key={'card' + p.task.id} className="suggestion" style={{top: p.bottom + 8}} role="dialog" aria-label={`Suggestion from ${p.task.title}`}>
      <div className="suggestion-head"><span className={'dot ' + p.task.status}/> {p.task.title}</div>
      <div className="suggestion-body md"><Markdown text={p.task.suggestion!.text} taskId={p.task.id} files={p.task.files}/></div>
      <div className="suggestion-actions">
        <button className="primary" onClick={() => settle(p.task, 'accepted')}>Insert below the passage</button>
        <button className="ghost" onClick={() => settle(p.task, 'dismissed')}>Dismiss</button>
        <button className="ghost" onClick={() => onOpenTask(p.task.id)}>Open conversation</button>
      </div>
    </div>)}
  </>;
}
