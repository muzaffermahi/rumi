import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {toConversation, readSessionEntries, legacyConversation} from '../lib/conversation.mjs';

const msg = message => ({type: 'message', message});

test('a multi-turn task reads as one chronological conversation', () => {
  const items = toConversation([
    {type: 'model_change'},
    msg({role: 'user', content: [{type: 'text', text: '<rumi-task>\nPlan it\n</rumi-task>\n\n<rumi-background>\nbg\n"""\ndoc\n"""\n</rumi-background>'}]}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'text', text: 'Looking.'}, {type: 'toolCall', id: 'a', name: 'web_search', arguments: {query: 'x'}}]}),
    msg({role: 'toolResult', toolCallId: 'a', content: [{type: 'text', text: 'results'}], isError: false}),
    msg({role: 'user', content: [{type: 'text', text: 'Make it shorter'}]}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'text', text: 'Shorter plan.'}], stopReason: 'stop'}),
    msg({role: 'user', content: 'Thanks, now a title'}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'text', text: 'Title.'}], stopReason: 'stop'}),
  ]);
  assert.deepEqual(items.map(i => `${i.role}:${i.text}`), ['user:Plan it', 'assistant:Looking.', 'user:Make it shorter', 'assistant:Shorter plan.', 'user:Thanks, now a title', 'assistant:Title.']);
  assert.equal(items[1].tools[0].name, 'web_search');
  assert.equal(items[1].tools[0].result, 'results');
  assert.equal(items[1].model, 'p/m');
});

test('existing v1 Pi sessions are readable', () => {
  const dir = 'data/sessions';
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const items = toConversation(readSessionEntries(path.join(dir, f)));
    assert.ok(items.length > 0, f);
    for (const i of items.filter(i => i.role === 'user')) assert.ok(!i.text.includes('Durable context'), f);
  }
});

test('tasks without sessions fall back to stored result, not a fabricated timeline', () => {
  const items = legacyConversation({objective: 'Do it', source: 'passage', updates: [{text: 'fix'}], result: 'Done'});
  assert.equal(items[0].role, 'note');
  assert.equal(items.at(-1).text, 'Done');
});

test('a successful offer_document call becomes an open button on that reply', () => {
  const items = toConversation([
    msg({role: 'user', content: 'Write a report'}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'toolCall', id: 'w', name: 'offer_document', arguments: {file: 'sub\\report.md', title: 'Report'}}, {type: 'toolCall', id: 'x', name: 'offer_document', arguments: {file: 'missing.md'}}]}),
    msg({role: 'toolResult', toolCallId: 'w', content: [{type: 'text', text: 'Offered'}], isError: false}),
    msg({role: 'toolResult', toolCallId: 'x', content: [{type: 'text', text: 'does not exist'}], isError: true}),
    msg({role: 'assistant', provider: 'p', model: 'm', content: [{type: 'text', text: 'Done.'}], stopReason: 'stop'}),
  ]);
  assert.deepEqual(items[1].offers, [{file: 'report.md', title: 'Report'}]);
  assert.equal(items[1].tools.length, 2);
});
