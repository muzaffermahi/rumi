// Small modules: settings validation, kind and preset files, documents in and out, version comparison, the diff,
// and git worktrees for Build tasks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {validate, jsonSchema, FIELDS} from '../server/config.mjs';
import {parseFrontmatter} from '../server/frontmatter.mjs';
import {toKind, kindsFor, KINDS} from '../pi/kinds.mjs';
import {presetsFor} from '../server/presets.mjs';
import {exportDocument, importDocument, toMarkdown} from '../server/documents.mjs';
import {newer} from '../server/update.mjs';
import {diffWords, similarity} from '../web/diff.ts';
import {applyWorktree, createWorktree, createWorktreeFromFiles, mergeWorktree, worktreeChanges, discardWorktree} from '../server/git.mjs';
import {enginesFor} from '../server/search.mjs';

test('settings are checked against their description', () => {
  assert.equal(validate({theme: 'dark', maxWorkers: 3, search: {providers: ['exa', 'brave']}}), null);
  assert.match(validate({theme: 'purple'}), /theme must be one of/);
  assert.match(validate({maxWorkers: 0}), /1 to 5/);
  assert.match(validate({search: {providers: ['google']}}), /can only contain/);
  assert.match(validate({nonsense: 1}), /not a setting/);
  assert.match(validate({search: {colour: 'red'}}), /search.colour is not a setting/);
});

test('the committed JSON schema matches the settings', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../schema/config.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(file.properties).sort(), Object.keys(jsonSchema().properties).sort(), 'run npm run schema');
  assert.deepEqual(
    Object.keys(FIELDS).sort(),
    Object.keys(jsonSchema().properties)
      .filter(k => k !== '$schema')
      .sort(),
  );
});

test('front matter: strings, numbers, booleans and lists', () => {
  const {data, body} = parseFrontmatter('---\nlabel: "Deep dive"\nsearchMin: 8\nneedsFolder: false\ntools: [read, web_search]\n---\nGo deep.\n');
  assert.deepEqual(data, {label: 'Deep dive', searchMin: 8, needsFolder: false, tools: ['read', 'web_search']});
  assert.equal(body, 'Go deep.');
  assert.deepEqual(parseFrontmatter('No header').data, {});
});

test('kind files are validated, and kinds that change files need a folder', () => {
  assert.throws(() => toKind('x', {data: {tools: ['rm']}, body: ''}), /unknown tools rm/);
  assert.throws(() => toKind('x', {data: {searchMin: 3, tools: ['read']}, body: ''}), /needs the web_search tool/);
  assert.throws(() => toKind('Bad Name', {data: {}, body: ''}), /file names/);
  assert.equal(toKind('fix', {data: {tools: ['read', 'edit']}, body: 'Fix it.'}).needsFolder, true);
  assert.equal(KINDS.research.searchMin, 5);
});

test('a project can add its own kinds and saved instructions', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-kinds-'));
  fs.mkdirSync(path.join(project, '.rumi', 'kinds'), {recursive: true});
  fs.mkdirSync(path.join(project, '.rumi', 'presets'), {recursive: true});
  fs.writeFileSync(
    path.join(project, '.rumi', 'kinds', 'review.md'),
    '---\nlabel: Review\norder: 5\ntools: [read, ls]\nthinking: high\n---\nReview the code carefully.',
  );
  fs.writeFileSync(path.join(project, '.rumi', 'kinds', 'broken.md'), '---\ntools: [rm]\n---\nNo.');
  fs.writeFileSync(path.join(project, '.rumi', 'presets', 'house-style.md'), '---\nlabel: House style\nkind: write\n---\nRewrite in our house style.');
  const {kinds, errors} = kindsFor(project);
  assert.equal(kinds.review.label, 'Review');
  assert.equal(kinds.review.source, 'project');
  assert.ok(
    errors.some(e => e.includes('broken.md')),
    'a broken file is reported, not fatal',
  );
  assert.ok(presetsFor(project).some(p => p.label === 'House style' && p.source === 'project'));
  fs.rmSync(project, {recursive: true, force: true});
});

test('documents: Markdown out keeps structure and drops task links; plain text and HTML in', () => {
  const md = toMarkdown(
    '<h2>Plan</h2><p>Use <span data-task="t1" class="task-link">sun</span> and <strong>water</strong>.</p><ul data-type="taskList"><li data-checked="true"><p>Dig</p></li></ul><table><tr><th>A</th></tr><tr><td>1</td></tr></table>',
  );
  assert.match(md, /^## Plan/);
  assert.match(md, /Use sun and \*\*water\*\*\./);
  assert.match(md, /- \[x\] Dig/);
  assert.match(md, /\| A +\|/);
  assert.equal(importDocument({name: 'a.txt', content: 'one\ntwo\n\nthree'}).html, '<p>one<br>two</p><p>three</p>');
  const html = importDocument({name: 'page.html', content: '<h1>T</h1><p onclick="x()">Hi</p><script>bad()</script><a href="javascript:x">l</a>'}).html;
  assert.ok(!/onclick|script|javascript/.test(html), html);
  assert.equal(exportDocument({title: 'a/b: c', html: '<p>x</p>'}, 'md').name, 'a b c.md');
  assert.throws(() => exportDocument({title: 't', html: ''}, 'pdf'), /md, html or txt/);
});

test('version comparison', () => {
  assert.ok(newer('1.10.0', '1.9.3'));
  assert.ok(newer('v0.5.0', '0.4.9'));
  assert.ok(!newer('0.4.0', '0.4.0'));
  assert.ok(!newer('0.4.0-beta.1', '0.4.0'));
});

test('the word diff marks additions and removals and keeps spacing', () => {
  const parts = diffWords('Tomatoes need at least eight hours of sun.', 'Tomatoes need eight hours of direct sun.');
  assert.equal(
    parts
      .filter(p => p.type !== 'del')
      .map(p => p.text)
      .join(''),
    'Tomatoes need eight hours of direct sun.',
  );
  assert.equal(
    parts
      .filter(p => p.type !== 'add')
      .map(p => p.text)
      .join(''),
    'Tomatoes need at least eight hours of sun.',
  );
  assert.ok(similarity('a b c d', 'a b c e') > 0.5);
  assert.ok(similarity('completely different', 'nothing alike here') < 0.3);
});

test('search uses the chosen engines; Bing is only the fallback', () => {
  assert.deepEqual(Object.keys(enginesFor({providers: ['exa', 'bing', 'brave']})), ['exa', 'brave']);
  assert.deepEqual(Object.keys(enginesFor({})), ['exa', 'duckduckgo']);
});

test('a Build task worktree lives on its own branch and merges into yours', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-wt-'));
  const git = (...a) => execFileSync('git', a, {cwd: repo, stdio: 'pipe'}).toString().trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Demo\n');
  fs.mkdirSync(path.join(repo, '.rumi'));
  fs.writeFileSync(path.join(repo, '.rumi', '.gitignore'), '*\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const id = 'abcdef12-0000';
  const dir = await createWorktree(repo, id);
  fs.writeFileSync(path.join(dir, 'new.txt'), 'from the task\n');
  const ch = await worktreeChanges(repo, id);
  assert.deepEqual(ch.files, [{status: 'added', path: 'new.txt'}]);
  assert.equal(ch.branch, 'rumi/abcdef12');
  assert.ok(!fs.existsSync(path.join(repo, 'new.txt')), 'your working copy is untouched until you merge');
  await mergeWorktree(repo, id, 'Add new.txt');
  // Git may convert line endings on checkout, depending on your settings.
  assert.equal(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8').replace(/\r\n/g, '\n'), 'from the task\n');
  assert.ok(!fs.existsSync(dir), 'the worktree is removed after merging');
  // Discarding another one leaves no branch behind.
  await createWorktree(repo, 'ffffffff-1');
  await discardWorktree(repo, 'ffffffff-1');
  assert.ok(!git('branch', '--list', 'rumi/ffffffff').length);
  fs.rmSync(repo, {recursive: true, force: true, maxRetries: 5});
});

test('a copy that overlaps your later edits is applied with the conflicts marked, and its branch kept', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-copy-'));
  const git = (...a) => execFileSync('git', a, {cwd: repo, stdio: 'pipe'}).toString().trim();
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'plan.txt'), 'one\ntwo\nthree\n');
  fs.mkdirSync(path.join(repo, '.rumi'));
  fs.writeFileSync(path.join(repo, '.rumi', '.gitignore'), '*\n');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const id = 'c0ffee00-0000';
  const {dir, base} = await createWorktreeFromFiles(repo, id);
  fs.writeFileSync(path.join(dir, 'plan.txt'), 'one\nTWO from the task\nthree\n');
  fs.writeFileSync(path.join(repo, 'plan.txt'), 'one\ntwo from you\nthree\n');
  await assert.rejects(applyWorktree(repo, id, base), /overlap with changes made in your folder since it started, in plan.txt/);
  assert.match(fs.readFileSync(path.join(repo, 'plan.txt'), 'utf8'), /<<<<<<<[\s\S]*two from you[\s\S]*TWO from the task/);
  assert.ok(git('branch', '--list', 'rumi/c0ffee00').length, 'the branch is kept');
  await discardWorktree(repo, id);
  fs.rmSync(repo, {recursive: true, force: true, maxRetries: 5});
});
