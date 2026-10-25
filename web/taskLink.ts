import {Mark, mergeAttributes} from '@tiptap/core';
import type {Editor} from '@tiptap/react';
import type {Node as PMNode} from '@tiptap/pm/model';

// Marks a delegated passage with the task it belongs to. Stored in the document HTML as <span data-task="…">,
// so the link survives edits, reloads and moving text around. Several tasks may cover the same text.
export const TaskLink = Mark.create({
  name: 'taskLink',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {taskId: {default: null, parseHTML: el => el.getAttribute('data-task'), renderHTML: a => ({'data-task': a.taskId})}};
  },
  parseHTML() {
    return [{tag: 'span[data-task]'}];
  },
  renderHTML({HTMLAttributes}) {
    return ['span', mergeAttributes(HTMLAttributes, {class: 'task-link'}), 0];
  },
});

export type LinkedRange = {from: number; to: number; text: string};

// Where each task's passage currently is: from the first to the last marked character.
export function linkedRanges(doc: PMNode): Map<string, LinkedRange> {
  const spans = new Map<string, {from: number; to: number}>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== 'taskLink' || !m.attrs.taskId) continue;
      const s = spans.get(m.attrs.taskId);
      const end = pos + node.nodeSize;
      spans.set(m.attrs.taskId, s ? {from: Math.min(s.from, pos), to: Math.max(s.to, end)} : {from: pos, to: end});
    }
  });
  const out = new Map<string, LinkedRange>();
  for (const [id, s] of spans) out.set(id, {...s, text: doc.textBetween(s.from, s.to, '\n\n', '\n')});
  return out;
}

export const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

export function linkPassage(editor: Editor, from: number, to: number, taskId: string) {
  const {state, view} = editor;
  view.dispatch(state.tr.addMark(from, to, state.schema.marks.taskLink.create({taskId})));
}

// Replaces a task's passage with new content, keeping it linked to the task. A one-paragraph answer replaces the
// words in place; a longer one replaces them with its blocks. One undo step.
export function replacePassage(editor: Editor, taskId: string, html: string) {
  const range = linkedRanges(editor.state.doc).get(taskId);
  if (!range) return false;
  const single = html.trim().match(/^<p>([\s\S]*)<\/p>$/);
  const content = single && !single[1].includes('<p>') ? single[1] : html;
  // One transaction, so a single undo puts the old passage back.
  editor
    .chain()
    .focus()
    .insertContentAt({from: range.from, to: range.to}, content, {updateSelection: true})
    .command(({tr, state}) => {
      const end = tr.selection.to;
      if (end > range.from) tr.addMark(range.from, end, state.schema.marks.taskLink.create({taskId}));
      return true;
    })
    .run();
  return true;
}

// Position just after the top-level block that ends a task's passage (null when the passage is gone).
export function afterPassage(editor: Editor, taskId: string): number | null {
  const range = linkedRanges(editor.state.doc).get(taskId);
  if (!range) return null;
  const $to = editor.state.doc.resolve(range.to);
  return $to.depth >= 1 ? $to.after(1) : range.to;
}
