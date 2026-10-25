// Telling you about a task while Rumi is in the background: the tab title counts tasks waiting for you, and (when you
// turned it on in Settings) a browser notification says which one finished or needs you.
import type {Task} from './api';
import {waitingOnUser} from './api';

const base = document.title;
const seen = new Map<string, string>();

export function trackTasks(tasks: Task[], enabled: boolean, onOpen: (id: string) => void) {
  const waiting = tasks.filter(t => waitingOnUser(t) || (t.suggestion && t.status === 'finished')).length;
  document.title = waiting ? `(${waiting}) ${base}` : base;
  for (const t of tasks) {
    const state = waitingOnUser(t) ? 'needs-you' : t.status;
    const before = seen.get(t.id);
    seen.set(t.id, state);
    if (!before || before === state || !enabled || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') continue;
    const body =
      state === 'needs-you'
        ? `Needs you: ${t.question?.question || t.dialog?.title || t.title}`
        : state === 'finished'
          ? t.handback?.summary || 'Finished'
          : state === 'failed'
            ? `Failed: ${t.error || ''}`
            : null;
    if (!body) continue;
    const n = new Notification(t.title, {body, tag: t.id, silent: state === 'finished'});
    n.onclick = () => {
      window.focus();
      onOpen(t.id);
      n.close();
    };
  }
}

export async function askPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}
