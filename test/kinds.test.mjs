import test from 'node:test';
import assert from 'node:assert/strict';
import {KINDS, kindFor, toolsFor, legacyKind, SHELL} from '../pi/kinds.mjs';

test('writing and thinking tasks get no shell or file editing; build does', () => {
  for (const k of ['research', 'write', 'think']) {
    assert.ok(!toolsFor(k).includes(SHELL) && !toolsFor(k).includes('edit'), k);
    assert.ok(toolsFor(k).includes('finish') && toolsFor(k).includes('ask_user'), k);
  }
  assert.ok(toolsFor('build').includes(SHELL) && toolsFor('build').includes('edit'));
  assert.equal(KINDS.research.searchMin, 5);
  assert.equal(KINDS.write.searchMin, 0);
});

test('build needs a project folder; unknown kinds fall back to research', () => {
  assert.throws(() => kindFor('build'), /need a project folder/);
  assert.equal(kindFor('build', {hasFolder: true}), 'build');
  assert.equal(kindFor('nonsense'), 'research');
});

test('tasks from before kinds keep their behaviour', () => {
  assert.equal(legacyKind({research: false}), 'write');
  assert.equal(legacyKind({research: true}), 'research');
  assert.equal(legacyKind({}), 'research');
  assert.equal(legacyKind({kind: 'think'}), 'think');
});
