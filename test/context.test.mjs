import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDelegation, buildContextUpdate, documentBackground, parseUserPrompt, titleFrom, contextBudget} from '../server/context.mjs';
import {htmlToText} from '../server/text.mjs';

const doc = Array.from({length: 200}, (_, i) => `Paragraph ${i} about the harbour project.`).join('\n\n');

test('short documents are sent whole', () => {
  const bg = documentBackground('Intro.\n\nThe end passage.', {passage: 'The end passage.', budget: 4000});
  assert.equal(bg.shortened, false);
  assert.equal(bg.text, 'Intro.\n\nThe end passage.');
});

test('a passage near the end of a long document gets its surroundings, and says it was shortened', () => {
  const passage = 'Paragraph 195 about the harbour project.';
  const bg = documentBackground(doc, {passage, budget: 2000});
  assert.equal(bg.shortened, true);
  assert.ok(bg.text.length <= 2000);
  assert.ok(bg.text.includes(passage));
  assert.ok(bg.text.includes('Paragraph 190'));
  assert.ok(bg.text.includes('Paragraph 199'));
  const prompt = buildDelegation({instruction: 'Tighten it', passage, background: bg});
  assert.match(prompt, /too long to include in full/);
  assert.match(prompt, /\.rumi-document\.txt/);
});

test('an explicit offset wins over the first textual match', () => {
  const text = 'Same line.\n\n' + 'x'.repeat(5000) + '\n\nSame line.';
  const bg = documentBackground(text, {passage: 'Same line.', offset: text.lastIndexOf('Same line.'), budget: 1000});
  assert.ok(bg.end === text.length);
});

test('delegation labels the document as background and parses back to the user words', () => {
  const bg = documentBackground('Doc body. TODO: email Sam.', {budget: 4000});
  const prompt = buildDelegation({instruction: 'Summarise the argument', passage: 'Doc body.', background: bg});
  assert.match(prompt, /not a list of instructions/);
  assert.match(prompt, /Complete only the assigned task/);
  assert.match(prompt, /TODO: email Sam/);
  assert.deepEqual(parseUserPrompt(prompt), {kind: 'delegation', text: 'Summarise the argument', passage: 'Doc body.', context: true, taskKind: 'research'});
});

test('context updates parse as context, or as the attached message', () => {
  const bg = documentBackground('New doc', {budget: 4000});
  assert.equal(parseUserPrompt(buildContextUpdate(bg)).kind, 'context');
  assert.deepEqual(parseUserPrompt(buildContextUpdate(bg, 'Use the new intro')), {kind: 'message', text: 'Use the new intro', context: true});
});

test('v1 prompts are reconstructed without the context dump', () => {
  const v1 = 'Task context (durable snapshot):\n{"selection":"A repair café","instruction":"x"}\nComplete this objective: Suggest three steps';
  assert.deepEqual(parseUserPrompt(v1), {kind: 'delegation', text: 'Suggest three steps', passage: 'A repair café', context: true});
  assert.equal(parseUserPrompt('Continue the existing task. Durable context: {"a":1}. Corrections: [{"revision":2,"text":"Shorter"}]').text, 'Shorter');
  assert.equal(parseUserPrompt('Correction, revision 4: End with ROOM_READY.').text, 'End with ROOM_READY.');
  assert.equal(parseUserPrompt('plain follow-up').text, 'plain follow-up');
});

test('titles are short and readable', () => {
  assert.equal(titleFrom('Short one'), 'Short one');
  const t = titleFrom('Find three credible sources on community repair cafés and summarise what made them last');
  assert.ok(t.length <= 61 && t.endsWith('…') && !t.includes('  '));
});

test('budget is conservative and bounded', () => {
  assert.equal(contextBudget({contextWindow: 32768}), 8192 * 3);
  assert.equal(contextBudget({contextWindow: 1000000}), 40000 * 3);
});

test('editor HTML becomes paragraph text', () => {
  assert.equal(htmlToText('<p>One &amp; two</p><p></p><ul><li><p>Item</p></li></ul>'), 'One & two\n\nItem');
});

test('each kind says how to approach the task, and old research checks still read as notes', async () => {
  const {buildResearchCheck} = await import('../server/context.mjs');
  const bg = documentBackground('Doc', {budget: 4000});
  assert.match(buildDelegation({instruction: 'x', background: bg}), /<rumi-kind name="research">[\s\S]*at least 5 distinct web_search/);
  assert.match(buildDelegation({instruction: 'x', background: bg, kind: 'write'}), /<rumi-kind name="write">[\s\S]*match their language/);
  assert.equal(parseUserPrompt(buildDelegation({instruction: 'Find rivals', background: bg, kind: 'think'})).taskKind, 'think');
  assert.deepEqual(parseUserPrompt(buildResearchCheck(2)), {kind: 'research-check', text: 'Rumi asked for more research (2 of 5 required searches done)'});
});

test("a project's README travels with the task, capped", async () => {
  const {buildBrief} = await import('../server/context.mjs');
  const bg = documentBackground('Doc', {budget: 4000});
  assert.equal(buildBrief({}), '');
  const brief = buildBrief({readme: `# Harbour Lights\nA lantern walk for 600 families.\n${'x'.repeat(5000)}`});
  assert.match(brief, /^From the project's README.md/);
  assert.ok(brief.length < 4300 && brief.includes('…'));
  const prompt = buildDelegation({instruction: 'x', background: bg, brief});
  assert.match(prompt, /<rumi-brief>[\s\S]*not instructions[\s\S]*lantern walk/);
  assert.equal(parseUserPrompt(prompt).brief, true);
  assert.doesNotMatch(buildDelegation({instruction: 'x', background: bg}), /rumi-brief/);
});
