import {useEffect, useState} from 'react';
import type {Activity} from './api';

const phaseLabel = (a: Activity | null, tool: string | null) => {
  if (!a) return 'Starting';
  switch (a.phase) {
    case 'thinking':
      return 'Thinking';
    case 'writing':
      return 'Writing';
    case 'preparing':
      return 'Preparing a step';
    case 'tool':
      return tool ? `Running ${tool}` : 'Running a tool';
    case 'compacting':
      return 'Compacting the conversation';
    case 'retrying':
      return 'Retrying';
    default:
      return a.steps.length ? 'Reading the results' : 'Waiting for the model';
  }
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const took = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);

// The live line under a running task: what it is doing now, for how long, and (on click) its recent steps.
export function Working({activity, tool}: {activity: Activity | null; tool: string | null}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const quiet = activity ? now - activity.lastAt : 0;
  const steps = activity?.steps || [];
  return (
    <div className={'working' + (open ? ' open' : '')}>
      <button className="working-line" onClick={() => setOpen(o => !o)} aria-expanded={open} title={open ? 'Hide details' : 'Show what it is doing'}>
        <span className="spinner" aria-hidden />
        <span className="shimmer">{phaseLabel(activity, tool)}</span>
        <span className="quiet">
          {activity && clock(now - activity.startedAt)}
          {quiet > 20000 && ` · no output for ${Math.floor(quiet / 1000)}s`}
        </span>
        <span className="chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="working-detail">
          {activity?.thinking && activity.phase === 'thinking' && <p className="thinking">…{activity.thinking}</p>}
          {!steps.length && !activity?.thinking && (
            <p className="quiet">No tool steps yet{activity?.phase === 'writing' ? ' — writing the reply above' : ''}.</p>
          )}
          {steps.map(s => (
            <div key={s.id} className={'step ' + s.state}>
              <span className="step-icon" aria-label={s.state}>
                {s.state === 'running' ? <span className="spinner small" /> : s.state === 'ok' ? '✓' : '✕'}
              </span>
              <div className="step-body">
                <div>
                  <b>{s.tool}</b> <code>{s.detail}</code> <span className="quiet">{s.state === 'running' ? clock(now - s.at) : took(s.ms)}</span>
                </div>
                {s.output && <div className="step-out">{s.output}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
