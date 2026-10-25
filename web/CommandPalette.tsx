import React, {useEffect, useMemo, useRef, useState} from 'react';
import {show} from './keys';

export type Command = {id: string; group: 'Commands' | 'Documents' | 'Tasks' | 'Workspaces'; label: string; hint?: string; keys?: string; run: () => void};

// Ctrl+K: jump to a document, task or workspace, or run a command, by typing a few letters of it.
export function CommandPalette({commands, onClose}: {commands: Command[]; onClose: () => void}) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = commands
      .map(c => {
        const text = `${c.label} ${c.hint || ''} ${c.group}`.toLowerCase();
        if (!words.every(w => text.includes(w))) return null;
        return {c, score: words.reduce((s, w) => s + (c.label.toLowerCase().startsWith(w) ? 2 : c.label.toLowerCase().includes(w) ? 1 : 0), 0)};
      })
      .filter(Boolean) as {c: Command; score: number}[];
    const order = ['Commands', 'Documents', 'Tasks', 'Workspaces'];
    return scored
      .sort((a, b) => (q ? b.score - a.score : 0) || order.indexOf(a.c.group) - order.indexOf(b.c.group))
      .map(x => x.c)
      .slice(0, 60);
  }, [q, commands]);
  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({block: 'nearest'});
  }, [index]);
  const run = (c: Command) => {
    onClose();
    setTimeout(c.run);
  };
  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder="Type a command, document or task…"
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Search commands"
          aria-activedescendant={hits[index] ? `cmd-${hits[index].id}` : undefined}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex(i => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length));
            } else if (e.key === 'Enter' && hits[index]) {
              e.preventDefault();
              run(hits[index]);
            }
          }}
        />
        <div className="items" ref={list} role="listbox">
          {!hits.length && <div className="empty">Nothing matches “{q}”.</div>}
          {hits.map((c, i) => {
            const head = !q && c.group !== lastGroup ? <div className="group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <React.Fragment key={c.id}>
                {head}
                <button
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === index}
                  className={i === index ? 'on' : ''}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(c)}
                >
                  <span className="grow">{c.label}</span>
                  {c.hint && <small>{c.hint}</small>}
                  {c.keys && <kbd>{show(c.keys)}</kbd>}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
