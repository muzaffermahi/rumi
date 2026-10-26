// The HTTP API end to end, against a real server and the scripted fake model: access, documents, the task loop,
// asking the user, and what a Build task changed (checkpoints and revert).
import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startFakeModel} from './fixtures/fake-model.mjs';
import {startRumi} from './fixtures/rumi.mjs';

let model, rumi;
before(async () => {
  model = await startFakeModel();
  rumi = await startRumi({modelPort: model.port});
});
after(async () => {
  await rumi?.stop();
  await model?.close();
});

test('the API needs the access token; the health check does not', async () => {
  assert.equal((await rumi.api('/health', {auth: false})).status, 200);
  assert.equal((await rumi.api('/workspaces', {auth: false})).status, 401);
  assert.equal((await rumi.api('/workspaces', {headers: {Authorization: 'Bearer wrong-token-of-the-same-size-xyz1'}, auth: false})).status, 401);
  assert.equal((await rumi.api('/workspaces')).status, 200);
});

test('other websites are refused even with a token', async () => {
  assert.equal((await rumi.api('/workspaces', {headers: {Origin: 'https://evil.example'}})).status, 403);
});

test('a new Rumi opens on the welcome document', async () => {
  const {body} = await rumi.api('/w/global/docs');
  assert.equal(body[0].title, 'Welcome to Rumi');
});

test('documents: create, save, conflict, rename, history, restore, export, delete', async () => {
  const {body: doc} = await rumi.api('/w/global/docs', {method: 'POST', body: {title: 'Plan'}});
  let r = await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PUT', body: {html: '<p>First</p>', baseRevision: 0}});
  assert.equal(r.body.revision, 1);
  r = await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PUT', body: {html: '<p>Stale tab</p>', baseRevision: 0}});
  assert.equal(r.status, 409, 'a save from an older revision is refused');
  assert.equal(r.body.html, '<p>First</p>');
  r = await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PUT', body: {html: '<p>Second</p>', baseRevision: 1}});
  assert.equal(r.body.revision, 2);
  await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PATCH', body: {title: 'The plan'}});
  const history = (await rumi.api(`/w/global/docs/${doc.id}/history`)).body;
  assert.ok(history.length >= 1);
  const first = history.at(-1);
  r = await rumi.api(`/w/global/docs/${doc.id}/restore`, {method: 'POST', body: {index: first.index}});
  assert.equal(r.body.html, '<p>First</p>');
  const md = await fetch(`${rumi.base}/api/w/global/docs/${doc.id}/export?format=md`, {headers: {Authorization: `Bearer ${rumi.token}`}}).then(x => x.text());
  assert.equal(md.trim(), 'First');
  assert.equal((await rumi.api(`/w/global/docs/${doc.id}`, {method: 'DELETE'})).status, 200);
  assert.equal((await rumi.api(`/w/global/docs/${doc.id}`)).status, 404);
});

test('importing Markdown makes a document, without scripts', async () => {
  const {body} = await rumi.api('/w/global/docs/import', {
    method: 'POST',
    body: {name: 'notes.md', content: '# Notes\n\n- [x] done\n\n<script>alert(1)</script>'},
  });
  assert.equal(body.title, 'Notes');
  const doc = (await rumi.api(`/w/global/docs/${body.id}`)).body;
  assert.ok(doc.html.includes('data-type="taskList"'));
  assert.ok(!doc.html.includes('<script'));
});

test('a delegated passage is handed back as a suggestion, with usage counted', async () => {
  const {body: doc} = await rumi.api('/w/global/docs', {method: 'POST', body: {title: 'Loop'}});
  await rumi.api(`/w/global/docs/${doc.id}`, {method: 'PUT', body: {html: '<p>Tomatoes need sun.</p>'}});
  const {body: t} = await rumi.api('/w/global/tasks', {
    method: 'POST',
    body: {selection: 'Tomatoes need sun.', instruction: 'Improve it', kind: 'write', docId: doc.id},
  });
  assert.equal(t.docId, doc.id);
  const done = await rumi.until(t.id);
  assert.equal(
    done.status,
    'finished',
    `${done.error}
${rumi.log().slice(-1500)}`,
  );
  assert.equal(done.handback.answer, 'FAKE ANSWER: Tomatoes need sun.');
  assert.equal(done.suggestion.text, 'FAKE ANSWER: Tomatoes need sun.');
  assert.ok(done.usage.total > 0, 'tokens are counted');
  assert.ok(done.elapsed > 0);
  // Accepting with a replaced passage makes that the task's passage.
  await rumi.api(`/tasks/${t.id}/suggestion`, {method: 'POST', body: {state: 'accepted', passage: 'FAKE ANSWER: Tomatoes need sun.'}});
  assert.equal((await rumi.api(`/tasks/${t.id}/summary`)).body.passage, 'FAKE ANSWER: Tomatoes need sun.');
  // The conversation shows the delegation and the hand-back.
  const conv = (await rumi.api(`/tasks/${t.id}`)).body;
  assert.equal(conv.items[0].kind, 'delegation');
  assert.ok(conv.items.some(i => i.handback?.answer));
});

test('a saved instruction names the task by its label', async () => {
  const {body: t} = await rumi.api('/w/global/tasks', {
    method: 'POST',
    body: {selection: 'A long passage about soil.', instruction: 'Rewrite at half the length.', label: 'Shorten', kind: 'write'},
  });
  assert.equal(t.title, 'Shorten: A long passage about soil.');
  await rumi.until(t.id);
});

test('a worker that must ask waits for you, then continues', async () => {
  const {body: t} = await rumi.api('/w/global/tasks', {method: 'POST', body: {instruction: 'Write a greeting [ask]', kind: 'think'}});
  const waiting = await rumi.until(t.id);
  assert.equal(waiting.status, 'needs-you', waiting.error);
  assert.equal(waiting.question.question, 'Formal or casual?');
  await rumi.api(`/tasks/${t.id}/messages`, {method: 'POST', body: {text: 'Casual'}});
  const done = await rumi.until(t.id, x => x.status === 'finished');
  assert.match(done.handback.answer, /Casual/);
});

test('a model error fails the task with its message; rerun makes a sibling to compare', async () => {
  const {body: t} = await rumi.api('/w/global/tasks', {method: 'POST', body: {instruction: 'Break [error]', kind: 'write'}});
  const failed = await rumi.until(t.id);
  assert.equal(failed.status, 'failed');
  const {body: again} = await rumi.api(`/tasks/${t.id}/rerun`, {method: 'POST', body: {model: 'fake/scripted'}});
  assert.equal(again.group, t.id);
  await rumi.until(again.id);
});

test('kinds and saved instructions come with the snapshot', async () => {
  const r = await fetch(`${rumi.base}/api/events`, {headers: {Authorization: `Bearer ${rumi.token}`}});
  const reader = r.body.getReader();
  const {value} = await reader.read();
  reader.cancel();
  const snap = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ''));
  assert.deepEqual(Object.keys(snap.kinds).slice(0, 3), ['research', 'write', 'think']);
  assert.ok(!('build' in snap.kinds) || snap.kinds.build.needsFolder);
  assert.ok(snap.presets.some(p => p.label === 'Shorten'));
  assert.equal(snap.settings.search.braveApiKey, false, 'secrets are reported as set or not, never sent');
});

test('settings are validated and saved to config.json', async () => {
  assert.equal((await rumi.api('/settings', {method: 'PUT', body: {maxWorkers: 9}})).status, 400);
  assert.equal((await rumi.api('/settings', {method: 'PUT', body: {theme: 'dark', search: {braveApiKey: 'secret-key'}}})).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(rumi.data, 'config.json'), 'utf8'));
  assert.equal(saved.theme, 'dark');
  assert.equal(saved.search.braveApiKey, 'secret-key');
  const {body} = await rumi.api('/settings', {method: 'PUT', body: {search: {braveApiKey: ''}}});
  assert.equal(body.search.braveApiKey, true, 'an empty key in the form keeps the saved one');
});

test('a Build task in a project is checkpointed, its changes listed, and reverted', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-project-'));
  fs.writeFileSync(path.join(project, 'README.md'), '# Demo\n');
  const {body: opened} = await rumi.api('/workspaces/open', {method: 'POST', body: {path: project}});
  const wid = opened.workspace.id;
  const {body: t} = await rumi.api(`/w/${wid}/tasks`, {method: 'POST', body: {instruction: 'Add a greeting file [build]', kind: 'build'}});
  const done = await rumi.until(t.id);
  assert.equal(done.status, 'finished', rumi.log().slice(-2000));
  assert.ok(fs.existsSync(path.join(project, 'hello.txt')), 'the worker wrote the file');
  assert.ok(done.changes, 'the task has a checkpoint');
  const changes = (await rumi.api(`/tasks/${t.id}/changes`)).body;
  assert.deepEqual(changes.files, [{status: 'added', path: 'hello.txt'}]);
  assert.match(changes.patch, /\+hello from the fake model/);
  await rumi.api(`/tasks/${t.id}/revert`, {method: 'POST'});
  assert.ok(!fs.existsSync(path.join(project, 'hello.txt')), 'revert removed the file');
  assert.ok(fs.existsSync(path.join(project, 'README.md')), 'and kept everything else');
  await rumi.api(`/tasks/${t.id}/unrevert`, {method: 'POST'});
  assert.ok(fs.existsSync(path.join(project, 'hello.txt')), 'undoing the revert brings it back');
  // Deleting the task removes its conversation and files.
  assert.equal((await rumi.api(`/tasks/${t.id}`, {method: 'DELETE'})).status, 200);
  assert.equal((await rumi.api(`/tasks/${t.id}/summary`)).status, 404);
  try {
    fs.rmSync(project, {recursive: true, force: true, maxRetries: 5});
  } catch {} // Windows keeps the workspace database open until the server stops
});

test('Build tasks need a project folder', async () => {
  const r = await rumi.api('/w/global/tasks', {method: 'POST', body: {instruction: 'Change files', kind: 'build'}});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /need a project folder/);
});

test("Claude subscription sign-in is refused (Anthropic's terms); an Anthropic API key is offered", async () => {
  const r = await rumi.api('/connections/login', {method: 'POST', body: {provider: 'anthropic', type: 'oauth'}});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Claude Code and Claude\.ai/);
  const setup = (await rumi.api('/setup')).body;
  assert.ok(!setup.subscriptions.some(p => p.id === 'anthropic'), 'no Claude sign-in button');
  assert.equal(setup.keys[0].id, 'anthropic', 'API keys lead with Anthropic');
});
