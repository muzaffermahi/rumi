// Markdown files with a small front-matter header, used for task kinds and saved instructions:
//   ---
//   label: Research
//   tools: [read, write, web_search]
//   searchMin: 5
//   ---
//   The body.
// Only flat keys are supported: strings, numbers, booleans and [lists]. Enough for these files, no YAML dependency.
import fs from 'node:fs';
import path from 'node:path';

const scalar = raw => {
  const v = raw.trim();
  if (/^".*"$|^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
};

export function parseFrontmatter(text) {
  const m = String(text)
    .replace(/^﻿/, '')
    .match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return {data: {}, body: String(text).trim()};
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    data[kv[1]] = /^\[.*\]$/.test(v)
      ? v
          .slice(1, -1)
          .split(',')
          .map(scalar)
          .filter(x => x !== '')
      : scalar(v);
  }
  return {data, body: m[2].trim()};
}

// Reads every .md file in the folders, later folders overriding earlier ones by file name.
export function readMarkdownDir(dirs) {
  const out = new Map();
  for (const {dir, source} of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter(n => n.endsWith('.md'));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        out.set(name.slice(0, -3).toLowerCase(), {...parseFrontmatter(fs.readFileSync(file, 'utf8')), file, source});
      } catch {}
    }
  }
  return out;
}
