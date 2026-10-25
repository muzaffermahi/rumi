import React from 'react';
import type {Shortcuts} from './api';
import {show} from './keys';

// Every keyboard shortcut, on "?".
export function ShortcutSheet({shortcuts, onClose}: {shortcuts: Shortcuts; onClose: () => void}) {
  const groups: [string, [string, string][]][] = [
    [
      'Rumi',
      [
        ['Delegate the selection (or the whole document)', show(shortcuts.delegate)],
        ['Command palette', show(shortcuts.palette)],
        ['New document', show(shortcuts.newDocument)],
        ['Focus mode', show(shortcuts.focusMode)],
        ['This list', show(shortcuts.shortcuts)],
      ],
    ],
    [
      'Writing',
      [
        ['Insert a block (heading, list, table…)', '/ at the start of a line'],
        ['Bold · Italic · Underline', `${show('Mod+B')} · ${show('Mod+I')} · ${show('Mod+U')}`],
        ['Undo · Redo', `${show('Mod+Z')} · ${show('Mod+Shift+Z')}`],
        ['Heading 1–3', `${show('Mod+Alt+1')}–3`],
        ['Bulleted · numbered list', `${show('Mod+Shift+8')} · ${show('Mod+Shift+7')}`],
        ['Checklist', show('Mod+Shift+9')],
      ],
    ],
    [
      'In the Delegate box',
      [
        ['Delegate', 'Enter'],
        ['Keep writing', 'Esc'],
      ],
    ],
  ];
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()} onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="dialog" role="dialog" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <table className="shortcuts-table">
          <tbody>
            {groups.map(([name, rows]) => (
              <React.Fragment key={name}>
                <tr>
                  <td colSpan={2}>
                    <h4>{name}</h4>
                  </td>
                </tr>
                {rows.map(([what, keys]) => (
                  <tr key={what}>
                    <td>{what}</td>
                    <td>
                      <kbd>{keys}</kbd>
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <div className="dialog-actions">
          <span className="quiet" style={{marginRight: 'auto'}}>
            Change them in Settings → Shortcuts.
          </span>
          <button className="primary" autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// The page was opened without Rumi's access token (another browser, or a bookmark from before a reinstall).
export function Locked() {
  return (
    <div className="locked" role="alert">
      <div>
        <div className="brand">rumi</div>
        <h1>Open Rumi from your computer</h1>
        <p>
          This page is locked, so other programs and websites can't use Rumi. Open it with the <code>rumi</code> command in a terminal, or with the Rumi
          shortcut, and it unlocks this browser.
        </p>
        <pre>rumi</pre>
        <p>
          Using another browser? Run <code>rumi link</code> and open the link it prints there.
        </p>
      </div>
    </div>
  );
}

// First steps, shown until you've delegated once and inserted an answer (or dismiss it).
export function Coach({steps, onDone}: {steps: {label: string; done: boolean}[]; onDone: () => void}) {
  const all = steps.every(s => s.done);
  return (
    <aside className="coach" aria-label="First steps">
      <h3>{all ? 'You’re set.' : 'Your first task'}</h3>
      <ol>
        {steps.map(s => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="row">
        <span className="quiet">
          {steps.filter(s => s.done).length} of {steps.length}
        </span>
        <button className={all ? 'primary' : 'ghost'} onClick={onDone}>
          {all ? 'Done' : 'Skip'}
        </button>
      </div>
    </aside>
  );
}
