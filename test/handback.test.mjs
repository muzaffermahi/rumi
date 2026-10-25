// Rumi's Pi extension: the hand-back tools and the check before a run settles, without a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rumiWorker} from '../pi/extension.mjs';
import {toConversation} from '../server/conversation.mjs';

function load(ctl) {
  const tools = new Map(),
    handlers = new Map();
  rumiWorker(ctl)({registerTool: t => tools.set(t.name, t), on: (name, fn) => handlers.set(name, fn)});
  return {tools, settle: e => handlers.get('agent_before_settle')({outcome: 'completed', entries: [], context: {canContinue: false}, ...e})};
}
const turn = over => ({expectFinish: true, requireResearch: false, finished: false, asked: false, nudged: {finish: 0, research: 0}, ...over});
const ctlOf = over => ({kind: 'write', searchMin: 0, budget: {used: 0, queries: new Set()}, cwd: '.', outDir: '.', turn: turn(), ...over});

test('finish hands the answer back and settles the run', async () => {
  let got;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-hb-'));
  const ctl = ctlOf({
    cwd: dir,
    outDir: dir,
    onFinish: h => {
      got = h;
    },
  });
  const {tools, settle} = load(ctl);
  await assert.rejects(tools.get('finish').execute('1', {answer: '  ', summary: 'x'}), /answer is empty/);
  await tools.get('finish').execute('2', {answer: 'We meet at nine.', summary: 'Friendlier line', assumptions: [' Staff only '], notes: ''});
  assert.equal(got.answer, 'We meet at nine.');
  assert.deepEqual(got.assumptions, ['Staff only']);
  assert.equal(ctl.turn.finished, true);
  assert.equal(settle(), undefined);
});

test('the tools follow the current run, not the one they were registered in', async () => {
  const ctl = ctlOf({turn: null});
  const {tools} = load(ctl);
  ctl.turn = turn();
  await tools.get('finish').execute('1', {answer: 'A', summary: 'a'});
  assert.equal(ctl.turn.finished, true);
});

test('a run that ends without finish is asked once, then left alone', () => {
  const {settle} = load(ctlOf());
  const r = settle({entries: [{type: 'custom', customType: 'other'}]});
  assert.equal(r.continue, true);
  assert.equal(r.entries.length, 2, 'earlier proposed entries are kept');
  assert.equal(r.entries[1].customType, 'rumi-check');
  assert.equal(r.entries[1].details.reason, 'finish');
  assert.equal(settle(), undefined);
  assert.equal(settle({outcome: 'aborted'}), undefined);
});

test('research tasks are asked for more searches before the hand-back check', () => {
  const {settle} = load(ctlOf({kind: 'research', searchMin: 5, budget: {used: 2, queries: new Set()}, turn: turn({requireResearch: true})}));
  assert.equal(settle().entries[0].details.reason, 'research');
  assert.equal(settle().entries[0].details.reason, 'finish');
  assert.equal(settle(), undefined);
});

test('asking the user ends the run without nudges', async () => {
  let asked;
  const ctl = ctlOf({
    kind: 'think',
    onAsk: q => {
      asked = q;
    },
  });
  const {tools, settle} = load(ctl);
  await tools.get('ask_user').execute('1', {question: 'Which city?', options: ['Izmir', 'Istanbul', 'Ankara', 'Bursa', 'Antalya']});
  assert.equal(asked.question, 'Which city?');
  assert.equal(asked.options.length, 4);
  assert.equal(settle(), undefined);
});

test('the conversation shows nudges, the hand-back and questions', () => {
  const msg = message => ({type: 'message', message});
  const items = toConversation([
    msg({role: 'user', content: 'Rewrite it'}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'text', text: 'Sure, here it is.'}], stopReason: 'stop'}),
    {type: 'custom_message', customType: 'rumi-check', content: '...', details: {reason: 'finish'}},
    msg({
      role: 'assistant',
      provider: 'p',
      model: 'm',
      content: [{type: 'toolCall', id: 'f', name: 'finish', arguments: {answer: 'We meet at nine.', summary: 'Friendlier'}}],
    }),
    msg({role: 'toolResult', toolCallId: 'f', content: [{type: 'text', text: 'Handed back'}], isError: false}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'text', text: 'Handed back.'}], stopReason: 'stop'}),
    msg({role: 'user', content: 'And a title?'}),
    msg({
      role: 'assistant',
      provider: 'p',
      model: 'm',
      content: [{type: 'toolCall', id: 'q', name: 'ask_user', arguments: {question: 'Formal or playful?', options: ['Formal', 'Playful']}}],
    }),
    msg({role: 'toolResult', toolCallId: 'q', content: [{type: 'text', text: 'asked'}], isError: false}),
  ]);
  assert.deepEqual(
    items.map(i => i.role + (i.kind ? ':' + i.kind : '')),
    ['user:message', 'assistant', 'note:check', 'assistant', 'user:message', 'assistant'],
  );
  assert.equal(items[2].text, 'Rumi asked the worker to hand back its result');
  assert.equal(items[3].handback.answer, 'We meet at nine.');
  assert.deepEqual(items[5].question.options, ['Formal', 'Playful']);
});
