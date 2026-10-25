// Saved instructions: one-click tasks like Fact-check or Shorten, offered in the Delegate box. Each is a Markdown
// file — front matter for its label and kind, the body is the instruction. Rumi's are in pi/presets/; add your own in
// <data>/presets/ or a project's <project>/.rumi/presets/.
import path from 'node:path';
import {appDir, dataDir} from './paths.mjs';
import {readMarkdownDir} from './frontmatter.mjs';

export function presetsFor(folder) {
  const dirs = [
    {dir: path.join(appDir, 'pi', 'presets'), source: 'builtin'},
    {dir: path.join(dataDir, 'presets'), source: 'user'},
  ];
  if (folder) dirs.push({dir: path.join(folder, '.rumi', 'presets'), source: 'project'});
  return [...readMarkdownDir(dirs)]
    .filter(([, f]) => f.body)
    .map(([id, f]) => ({id, label: String(f.data.label || id), kind: f.data.kind ? String(f.data.kind) : null, instruction: f.body, source: f.source}))
    .sort((a, b) => a.label.localeCompare(b.label));
}
