import {JSDOM} from 'jsdom';
// Plain text from editor HTML, with blank lines between blocks (matches the client's serialisation).
export function htmlToText(html) {
  const marked = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|blockquote|pre)>/gi, '$&\E000');
  const text = JSDOM.fragment(`<div>${marked}</div>`).textContent || '';
  return text.split('\E000').map(s => s.trim()).filter(Boolean).join('\n\n');
}
