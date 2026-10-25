import type React from 'react';
import {createContext, useCallback, useContext, useMemo, useRef, useState} from 'react';
import {errorText} from './api';

// Short messages at the bottom of the window. They stack, fade on their own, and can carry one action ("Undo").
type Toast = {id: number; text: string; bad?: boolean; action?: {label: string; run: () => void}};
type Api = {notify: (text: string, opts?: {action?: Toast['action']; ms?: number}) => void; error: (e: unknown) => void};

const Ctx = createContext<Api>({notify: () => {}, error: () => {}});
export const useToasts = () => useContext(Ctx);

export function ToastProvider({children}: {children: React.ReactNode}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const drop = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>, ms: number) => {
      const id = next.current++;
      setToasts(all => [...all.filter(x => x.text !== t.text), {...t, id}].slice(-4));
      if (ms) setTimeout(() => drop(id), ms);
    },
    [drop],
  );
  const value = useMemo<Api>(
    () => ({
      notify: (text, opts = {}) => push({text, action: opts.action}, opts.ms ?? (opts.action ? 7000 : 3500)),
      error: e => {
        const text = errorText(e);
        if (text.startsWith('Rumi is locked')) return;
        push({text, bad: true}, 9000);
      },
    }),
    [push],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`} role={t.bad ? 'alert' : 'status'}>
            {t.text}
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  drop(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="ghost" onClick={() => drop(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
