import {useState} from 'react';
import {api, type Task} from './api';

// A worker waiting on the user: its own question (ask_user), or a question from a Pi extension (confirm, select, input).
// Answering continues the task in the same session.
export function Ask({task, onError, autoFocus}: {task: Task; onError: (e: unknown) => void; autoFocus?: boolean}) {
  const [text, setText] = useState(task.dialog?.prefill || '');
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setText('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const reply = (value: string) => act(() => api(`/tasks/${task.id}/messages`, 'POST', {text: value}));
  const answer = (value: unknown) => act(() => api(`/tasks/${task.id}/dialog`, 'POST', {id: task.dialog!.id, value}));

  if (task.dialog) {
    const d = task.dialog;
    return (
      <div className="ask" role="group" aria-label="The worker is asking">
        <div className="ask-q">{d.title}</div>
        {d.message && <div className={'ask-why' + (d.title === 'Run this command?' ? ' command' : '')}>{d.message}</div>}
        {d.kind === 'confirm' && (
          <div className="ask-options">
            <button className="primary" disabled={busy} onClick={() => answer(true)}>
              {d.title === 'Run this command?' ? 'Run it' : 'Yes'}
            </button>
            <button className="ghost" disabled={busy} onClick={() => answer(false)}>
              {d.title === 'Run this command?' ? 'Don’t run it' : 'No'}
            </button>
          </div>
        )}
        {d.kind === 'select' && (
          <div className="ask-options">
            {(d.options || []).map(o => (
              <button key={o} className="choice" disabled={busy} onClick={() => answer(o)}>
                {o}
              </button>
            ))}
            <button className="ghost" disabled={busy} onClick={() => answer(undefined)}>
              Skip
            </button>
          </div>
        )}
        {d.kind === 'input' && (
          <form
            className="ask-input"
            onSubmit={e => {
              e.preventDefault();
              answer(text);
            }}
          >
            <input autoFocus={autoFocus} value={text} placeholder={d.placeholder || 'Your answer'} onChange={e => setText(e.target.value)} />
            <button className="primary" disabled={busy}>
              Answer
            </button>
          </form>
        )}
      </div>
    );
  }

  const q = task.question;
  if (!q) return null;
  return (
    <div className="ask" role="group" aria-label="The worker needs you">
      <div className="ask-q">{q.question}</div>
      {q.why && <div className="ask-why">{q.why}</div>}
      {!!q.options.length && (
        <div className="ask-options">
          {q.options.map(o => (
            <button key={o} className="choice" disabled={busy} onClick={() => reply(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <form
        className="ask-input"
        onSubmit={e => {
          e.preventDefault();
          if (text.trim()) reply(text.trim());
        }}
      >
        <input
          autoFocus={autoFocus}
          value={text}
          placeholder={q.options.length ? 'Or write your own answer' : 'Your answer'}
          onChange={e => setText(e.target.value)}
        />
        <button className="primary" disabled={busy || !text.trim()}>
          Answer
        </button>
      </form>
    </div>
  );
}
