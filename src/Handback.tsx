import React from 'react';
import type {Handback} from './api';
import {Markdown} from './Markdown';

// What a worker handed back with finish: the answer (ready to insert), then its notes and assumptions, folded away.
export function HandbackView({handback, taskId, files, clip}: {handback: Handback; taskId: string; files: string[]; clip?: boolean}) {
  const extra = handback.notes || handback.assumptions?.length;
  return <div className="handback">
    <div className={'handback-answer md' + (clip ? ' clip' : '')}><Markdown text={handback.answer} taskId={taskId} files={files}/></div>
    {!!extra && <details className="handback-notes">
      <summary>{[handback.notes && 'Notes and sources', handback.assumptions?.length && `${handback.assumptions.length} assumption${handback.assumptions.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</summary>
      {!!handback.assumptions?.length && <ul className="assumptions">{handback.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      {handback.notes && <div className="md"><Markdown text={handback.notes} taskId={taskId} files={files}/></div>}
    </details>}
  </div>;
}
