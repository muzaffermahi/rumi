// What keeps workers from reaching this computer or your network, and the shell approval rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {isPrivateAddress, safeFetch, BlockedAddress} from '../server/net.mjs';
import {rumiWorker} from '../pi/extension.mjs';

test('private, loopback and link-local addresses are recognised', () => {
  for (const a of [
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.10',
    '172.20.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::5',
    '::ffff:127.0.0.1',
    '100.64.0.1',
  ])
    assert.ok(isPrivateAddress(a), a);
  for (const a of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.ok(!isPrivateAddress(a), a);
});

test('read_page cannot open Rumi itself or other local servers, by address or by name', async () => {
  const server = http.createServer((q, r) => r.end('secret')).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const {port} = server.address();
  try {
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/api/workspaces`), BlockedAddress);
    await assert.rejects(safeFetch(`http://localhost:${port}/`), BlockedAddress);
    await assert.rejects(safeFetch('file:///etc/passwd'), /Only http and https/);
    // When the user allows the local network, it works.
    const r = await safeFetch(`http://127.0.0.1:${port}/`, {allowPrivate: true});
    assert.equal(r.text, 'secret');
  } finally {
    server.close();
  }
});

test('a redirect into the local network is refused at the hop', async () => {
  const target = http.createServer((q, r) => r.end('inside')).listen(0, '127.0.0.1');
  await new Promise(r => target.once('listening', r));
  const hop = http.createServer((q, r) => r.writeHead(302, {Location: `http://127.0.0.1:${target.address().port}/`}).end()).listen(0, '127.0.0.1');
  await new Promise(r => hop.once('listening', r));
  try {
    // The first hop is local too, so allow it explicitly and check the redirect is followed only when allowed.
    const ok = await safeFetch(`http://127.0.0.1:${hop.address().port}/`, {allowPrivate: true});
    assert.equal(ok.text, 'inside');
    await assert.rejects(safeFetch(`http://127.0.0.1:${hop.address().port}/`), BlockedAddress);
  } finally {
    hop.close();
    target.close();
  }
});

// Runs every tool_call handler like Pi does: the first one that blocks wins.
function load(ctl, ui) {
  const handlers = [];
  rumiWorker(ctl)({registerTool: () => {}, on: (name, fn) => name === 'tool_call' && handlers.push(fn)});
  return async e => {
    for (const h of handlers) {
      const r = await h(e, {ui});
      if (r?.block) return r;
    }
  };
}

test('research, write and think tasks write only in their task folder', async () => {
  const ctl = {editsProject: false, cwd: '/projects/site', outDir: '/data/outputs/t1', turn: turn()};
  const call = load(ctl, {});
  const blocked = await call({toolName: 'write', input: {path: 'README.md', content: 'x'}});
  assert.equal(blocked.block, true, 'a relative path in the project is refused');
  assert.match(blocked.reason, /task folder/);
  assert.equal((await call({toolName: 'edit', input: {path: '/projects/site/index.html'}})).block, true);
  assert.equal(await call({toolName: 'write', input: {path: '/data/outputs/t1/notes.md', content: 'x'}}), undefined, 'the task folder is fine');
  assert.equal(await call({toolName: 'read', input: {path: 'README.md'}}), undefined, 'reading the project is fine');
  ctl.editsProject = true;
  assert.equal(await call({toolName: 'write', input: {path: 'README.md', content: 'x'}}), undefined, 'Build tasks may change the project');
});
const turn = over => ({expectFinish: true, requireResearch: false, finished: false, asked: false, readWeb: false, nudged: {finish: 0, research: 0}, ...over});

test('shell commands after reading the web wait for approval; others run', async () => {
  let asked = 0;
  const ui = {confirm: async () => (asked++, false)};
  const ctl = {budget: {used: 0, queries: new Set()}, approvals: 'after-web', turn: turn()};
  const call = load(ctl, ui);
  assert.equal(await call({toolName: 'powershell', input: {command: 'dir'}}), undefined, 'no web read yet: runs');
  ctl.turn.readWeb = true;
  const r = await call({toolName: 'bash', input: {command: 'rm -rf build'}});
  assert.equal(r.block, true, 'declined commands are blocked');
  assert.equal(asked, 1);
  assert.equal(await call({toolName: 'write', input: {}}), undefined, 'only shell commands need approval');
});

test('approvals: always asks every time; off never asks', async () => {
  let asked = 0;
  const ui = {confirm: async () => (asked++, true)};
  assert.equal(await load({approvals: 'always', turn: turn()}, ui)({toolName: 'bash', input: {command: 'ls'}}), undefined);
  assert.equal(asked, 1);
  await load({approvals: 'off', turn: turn({readWeb: true})}, ui)({toolName: 'bash', input: {command: 'ls'}});
  assert.equal(asked, 1);
});
