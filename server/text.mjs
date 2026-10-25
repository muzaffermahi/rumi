import {JSDOM} from 'jsdom';

// A private-use character marks block ends; it never appears in real text (earlier versions used the letters "E000").
const END = '';

// Plain text from editor HTML, with blank lines between blocks (matches the client's serialisation).
export function htmlToText(html) {
  const marked = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|pre)>/gi, `$&${END}`);
  const text = JSDOM.fragment(`<div>${marked}</div>`).textContent || '';
  return text
    .split(END)
    .map(s => s.trim())
    .filter(Boolean)
    .join('\n\n');
}
