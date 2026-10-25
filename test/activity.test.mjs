import test from 'node:test';
import assert from 'node:assert/strict';
import {newActivity, track} from '../server/activity.mjs';

test('activity follows thinking, tool steps with partial output, and results', () => {
  const a = newActivity();
  track(a, {type: 'message_start', message: {role: 'assistant'}});
  track(a, {type: 'message_update', assistantMessageEvent: {type: 'thinking_delta', delta: 'Let me look at the src folder.'}});
  assert.equal(a.phase, 'thinking');
  assert.match(a.thinking, /src folder/);
  track(a, {type: 'tool_execution_start', toolCallId: 'c1', toolName: 'powershell', args: {command: 'Get-ChildItem\n  -Recurse src'}});
  assert.equal(a.phase, 'tool');
  assert.deepEqual([a.steps[0].tool, a.steps[0].detail, a.steps[0].state], ['powershell', 'Get-ChildItem -Recurse src', 'running']);
  track(a, {type: 'tool_execution_update', toolCallId: 'c1', partialResult: {content: [{type: 'text', text: 'a.ts\nb.ts\n'}]}});
  assert.equal(a.steps[0].output, 'b.ts');
  track(a, {type: 'tool_execution_end', toolCallId: 'c1', isError: true, result: {content: [{type: 'text', text: 'Access denied'}]}});
  assert.deepEqual([a.steps[0].state, a.steps[0].output, a.phase], ['failed', 'Access denied', 'waiting']);
  assert.ok(a.steps[0].ms >= 0);
});

test('only the last six steps are kept', () => {
  const a = newActivity();
  for (let i = 0; i < 9; i++) track(a, {type: 'tool_execution_start', toolCallId: 'c' + i, toolName: 'read', args: {path: `f${i}.ts`}});
  assert.deepEqual(
    a.steps.map(s => s.detail),
    ['f3.ts', 'f4.ts', 'f5.ts', 'f6.ts', 'f7.ts', 'f8.ts'],
  );
});
