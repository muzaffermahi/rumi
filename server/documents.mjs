// Moving documents in and out of Rumi: Markdown, HTML and plain text. Task links (the highlighted passages) are
// Rumi's own and are left out of exports.
import TurndownService from 'turndown';
import {gfm} from '@joplin/turndown-plugin-gfm';
import {marked} from 'marked';
import {JSDOM} from 'jsdom';
import {htmlToText} from './text.mjs';

const turndown = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*'});
turndown.use(gfm);
// TipTap task lists: <ul data-type="taskList"><li data-checked="true">…
turndown.addRule('taskItem', {
  filter: node => node.nodeName === 'LI' && node.parentNode?.getAttribute?.('data-type') === 'taskList',
  replacement: (content, node) => `- [${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim().replace(/\n+/g, ' ')}\n`,
});

// Plain "- item" and "1. item" instead of turndown's padded markers.
turndown.addRule('listItem', {
  filter: node => node.nodeName === 'LI' && node.parentNode?.getAttribute?.('data-type') !== 'taskList',
  replacement: (content, node, options) => {
    const parent = node.parentNode;
    const index = Array.prototype.filter.call(parent.childNodes, n => n.nodeName === 'LI').indexOf(node);
    const marker = parent.nodeName === 'OL' ? `${Number(parent.getAttribute('start') || 1) + index}. ` : `${options.bulletListMarker} `;
    const body = content
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      .replace(/\n\n+/g, '\n')
      .replace(/\n/g, `\n${' '.repeat(marker.length)}`);
    return `${marker}${body}\n`;
  },
});

const unlink = html => String(html || '').replace(/<span[^>]*data-task="[^"]*"[^>]*>([\s\S]*?)<\/span>/g, '$1');
const escapeHtml = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);

export function toMarkdown(html) {
  return `${turndown
    .turndown(unlink(html))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

export function toHtmlPage(title, html) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{max-width:720px;margin:48px auto;padding:0 20px;font:17px/1.65 Georgia,serif;color:#22251f}h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}
pre{background:#f1f0e8;padding:12px;border-radius:6px;overflow:auto}code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
blockquote{border-left:3px solid #bfc7b2;margin-left:0;padding-left:16px;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}img{max-width:100%}</style>
</head><body>
${unlink(html)}
</body></html>
`;
}

export function exportDocument({title, html, text}, format) {
  const base =
    String(title || 'document')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'document';
  if (format === 'md') return {name: `${base}.md`, type: 'text/markdown; charset=utf-8', body: toMarkdown(html)};
  if (format === 'html') return {name: `${base}.html`, type: 'text/html; charset=utf-8', body: toHtmlPage(title, html)};
  if (format === 'txt') return {name: `${base}.txt`, type: 'text/plain; charset=utf-8', body: `${text ?? htmlToText(html)}\n`};
  throw Error('Export as md, html or txt.');
}

// Removes scripts, styles, frames and event handlers: imported files are other people's content.
function sanitize(html) {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  // GFM task lists become the editor's checklists.
  for (const box of doc.querySelectorAll('li > input[type="checkbox"]')) {
    const li = box.parentElement;
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(box.hasAttribute('checked')));
    li.parentElement.setAttribute('data-type', 'taskList');
    box.remove();
  }
  for (const el of doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button')) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*(javascript|vbscript|data):/i.test(a.value)) el.removeAttribute(a.name);
  }
  return doc.body.innerHTML;
}

const textToHtml = text =>
  String(text)
    .split(/\r?\n\s*\r?\n/)
    .map(p => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');

// Turns an imported file into editor HTML.
export function importDocument({name = '', content = ''}) {
  const ext = name.toLowerCase().split('.').pop();
  let html;
  if (ext === 'html' || ext === 'htm') html = new JSDOM(content).window.document.body.innerHTML;
  else if (ext === 'txt') html = textToHtml(content);
  else html = marked.parse(String(content), {gfm: true, async: false});
  const title = (String(content).match(/^#\s+(.+)$/m)?.[1] || name.replace(/\.[^.]+$/, '') || 'Imported').trim().slice(0, 120);
  return {title, html: sanitize(html)};
}
