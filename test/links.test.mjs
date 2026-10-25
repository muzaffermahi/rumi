// Runs the real editor schema in Node (Node strips the TypeScript types of web/taskLink.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {EditorState, TextSelection} from '@tiptap/pm/state';
import {TaskLink, linkedRanges, sameText} from '../web/taskLink.ts';

const schema = getSchema([StarterKit, TaskLink]);
const p = text => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const docOf = (...texts) => schema.node('doc', null, texts.map(p));

function link(state, from, to, taskId) {
  return state.apply(state.tr.addMark(from, to, schema.marks.taskLink.create({taskId})));
}

test('a linked passage is found again after edits elsewhere, and edits inside it are noticed', () => {
  let state = EditorState.create({schema, doc: docOf('Intro.', 'Who are my competitors?', 'Outro.')});
  const start = 9,
    end = start + 'Who are my competitors?'.length; // inside the second paragraph
  state = link(state, start, end, 't1');
  // Typing before the passage moves it but keeps it linked.
  state = state.apply(state.tr.insertText('New opening. ', 1));
  let r = linkedRanges(state.doc).get('t1');
  assert.equal(r.text, 'Who are my competitors?');
  assert.ok(sameText(r.text, 'Who are my  competitors?'));
  // Rewriting a word inside the passage is a change since delegation.
  const at = state.doc.textBetween(0, state.doc.content.size, '\n').indexOf('competitors');
  r = linkedRanges(state.doc).get('t1');
  state = state.apply(state.tr.insertText('rivals', r.from + 'Who are my '.length, r.from + 'Who are my competitors'.length));
  r = linkedRanges(state.doc).get('t1');
  assert.equal(r.text, 'Who are my rivals?');
  assert.ok(at > 0 && !sameText(r.text, 'Who are my competitors?'));
});

test('two tasks can share text, and a deleted passage is no longer linked', () => {
  let state = EditorState.create({schema, doc: docOf('One two three')});
  state = link(state, 1, 8, 'a');
  state = link(state, 5, 14, 'b');
  const ranges = linkedRanges(state.doc);
  assert.equal(ranges.get('a').text, 'One two');
  assert.equal(ranges.get('b').text, 'two three');
  state = state.apply(state.tr.delete(1, 14));
  assert.equal(linkedRanges(state.doc).size, 0);
});

test('the link is stored in the document HTML and read back', async () => {
  const {DOMSerializer, DOMParser} = await import('@tiptap/pm/model');
  const {JSDOM} = await import('jsdom');
  const {document} = new JSDOM('').window;
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Hi', [schema.marks.taskLink.create({taskId: 'x1'})])])]);
  const div = document.createElement('div');
  div.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, {document}));
  assert.match(div.innerHTML, /<span data-task="x1" class="task-link">Hi<\/span>/);
  const back = DOMParser.fromSchema(schema).parse(div);
  assert.equal(linkedRanges(back).get('x1').text, 'Hi');
  void TextSelection;
});
