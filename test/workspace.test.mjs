import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore, workspaceId, projectDataDir} from '../server/store.mjs';
import {buildPassageUpdate, parseUserPrompt} from '../server/context.mjs';

test('a project workspace keeps its data in <project>/.rumi, hidden from git', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-ws-'));
  const store = openStore(projectDataDir(project), {project: true});
  store.put('document', {html: '<p>Hi</p>', text: 'Hi', revision: 1});
  assert.deepEqual(openStore(projectDataDir(project), {project: true}).get('document').text, 'Hi');
  assert.equal(
    fs
      .readFileSync(path.join(project, '.rumi', '.gitignore'), 'utf8')
      .trim()
      .split('\n')
      .at(-1),
    '*',
  );
  assert.equal(store.outputDir('t1'), path.join(project, '.rumi', 'outputs', 't1'));
  assert.equal(store.sessionsDir, path.join(project, '.rumi', 'sessions'));
  store.db.close();
});

test('workspace ids are stable and ignore path case', () => {
  assert.equal(workspaceId('C:\\Code\\Site'), workspaceId('c:\\code\\site'));
  assert.notEqual(workspaceId('C:\\Code\\Site'), workspaceId('C:\\Code\\Other'));
});

test('a passage update is shown as the new passage, not as the raw prompt', () => {
  assert.deepEqual(parseUserPrompt(buildPassageUpdate('Making $500 a month?')), {
    kind: 'passage-update',
    text: 'Updated passage',
    passage: 'Making $500 a month?',
  });
});
