import test from 'node:test';
import assert from 'node:assert/strict';
import {folderTaken, nextToStart, throttle} from '../server/queue.mjs';

const t = (id, status, extra = {}) => ({id, status, created: `2026-10-24T10:00:0${id}Z`, ...extra});

test('starts oldest queued tasks up to the limit', () => {
  const tasks = [t(3, 'queued'), t(2, 'queued'), t(1, 'queued')];
  assert.deepEqual(
    nextToStart(tasks, 2).map(x => x.id),
    [1, 2],
  );
  assert.deepEqual(
    nextToStart(tasks, 1).map(x => x.id),
    [1],
  );
});

test('queued work waits while both slots are occupied', () => {
  const tasks = [t(1, 'running'), t(2, 'running'), t(3, 'queued')];
  assert.deepEqual(nextToStart(tasks, 2), []);
  tasks[0].status = 'cancelled';
  assert.deepEqual(
    nextToStart(tasks, 2).map(x => x.id),
    [3],
  );
});

test('a limit of one runs tasks one at a time', () => {
  assert.deepEqual(nextToStart([t(1, 'running'), t(2, 'queued')], 1), []);
});

test('tasks sharing an external project folder run sequentially', () => {
  const tasks = [t(1, 'running', {projectDir: 'C:\\Code\\site\\'}), t(2, 'queued', {projectDir: 'c:/code/site'}), t(3, 'queued')];
  assert.deepEqual(
    nextToStart(tasks, 2).map(x => x.id),
    [3],
  );
  const both = [t(1, 'queued', {projectDir: 'C:/a'}), t(2, 'queued', {projectDir: 'C:/a'})];
  assert.deepEqual(
    nextToStart(both, 2).map(x => x.id),
    [1],
  );
});

test('tasks in the same folder may run side by side when allowed', () => {
  const tasks = [t(1, 'running', {projectDir: 'C:/a'}), t(2, 'queued', {projectDir: 'C:/a'})];
  assert.deepEqual(nextToStart(tasks, 2), []);
  assert.deepEqual(
    nextToStart(tasks, 2, {sameFolder: true}).map(x => x.id),
    [2],
  );
});

test('re-queued tasks keep their place by queuedAt', () => {
  const tasks = [t(1, 'queued', {queuedAt: '2026-10-24T12:00:00Z'}), t(2, 'queued')];
  assert.deepEqual(
    nextToStart(tasks, 1).map(x => x.id),
    [2],
  );
});

test('throttle batches many calls into few', async () => {
  let calls = 0;
  const f = throttle(() => calls++, 50);
  for (let i = 0; i < 1000; i++) f();
  await new Promise(r => setTimeout(r, 120));
  assert.equal(calls, 1);
  f();
  f.flush();
  assert.equal(calls, 2);
});

test('only tasks that change the folder wait for it; one that can work on a copy starts', () => {
  const build = t => t.kind === 'build';
  const tasks = [
    t(1, 'running', {projectDir: 'C:/a', kind: 'build'}),
    t(2, 'queued', {projectDir: 'C:/a', kind: 'research'}),
    t(3, 'queued', {projectDir: 'C:/a', kind: 'build'}),
  ];
  assert.deepEqual(
    nextToStart(tasks, 3, {holdsFolder: build}).map(x => x.id),
    [2],
    'Research runs beside a Build task; a second Build task waits',
  );
  assert.deepEqual(
    nextToStart(tasks, 3, {holdsFolder: build, canSeparate: build}).map(x => x.id),
    [2, 3],
    'unless it can work on its own copy',
  );
  assert.ok(folderTaken(tasks[2], tasks, build));
  assert.ok(!folderTaken(tasks[0], tasks, build), 'the holder itself is not kept out');
});
