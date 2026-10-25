import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describeFolder, remember} from '../lib/folders.mjs';
import {buildDelegation, documentBackground} from '../lib/context.mjs';

test('folders are resolved, checked, and repos recognised', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-folder-'));
  assert.deepEqual(describeFolder(`"${dir}"`), {path: dir, name: path.basename(dir), exists: true, isRepo: false});
  fs.mkdirSync(path.join(dir, '.git'));
  assert.equal(describeFolder(dir).isRepo, true);
  assert.equal(describeFolder(path.join(dir, 'missing')).exists, false);
  fs.rmSync(dir, {recursive: true});
});

test('recent folders put the latest first, without duplicates, up to six', () => {
  const f = n => ({path: `C:\\p\\${n}`, name: n, isRepo: false});
  let recent = [];
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) recent = remember(recent, f(n));
  recent = remember(recent, {path: 'c:\\p\\c', name: 'C', isRepo: false});
  assert.deepEqual(recent.map(x => x.name), ['C', 'g', 'f', 'e', 'd', 'b']);
});

test('the worker is told the folder is its working directory and where user notes go', () => {
  const p = buildDelegation({instruction: 'Fix the README', background: documentBackground('', {budget: 4000}), projectDir: 'C:\\code\\site', outputDir: 'C:\\rumi\\outputs\\t1'});
  assert.ok(p.includes('The user opened this folder for the task: C:\\code\\site'));
  assert.ok(p.includes('It is your working directory'));
  assert.ok(p.includes('C:\\rumi\\outputs\\t1'));
});

test('an empty path is not a folder (it must not fall back to the current directory)', async () => {
  const {describeFolder} = await import('../lib/folders.mjs');
  for (const p of ['', '   ', undefined, '""']) assert.equal(describeFolder(p).exists, false);
});
