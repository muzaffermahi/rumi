import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Same options as src/Markdown.tsx
const render = text => renderToStaticMarkup(createElement(ReactMarkdown, {remarkPlugins: [remarkGfm], skipHtml: true}, text));

test('agent Markdown renders, raw HTML does not', () => {
  const html = render('# Title\n\n**bold** [link](https://example.org)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example.org">link<\/a>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script|<img|onerror/);
});

test('javascript: links are neutralised', () => {
  assert.doesNotMatch(render('[x](javascript:alert(1))'), /javascript:/);
});
