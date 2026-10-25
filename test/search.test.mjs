import test from 'node:test';
import assert from 'node:assert/strict';
import {search} from '../lib/search.mjs';

const r = (engine, ...urls) => async () => urls.map(u => ({title: u, url: u, snippet: '', engine}));

test('engines are merged in turn and duplicate URLs dropped', async () => {
  const {results} = await search('q', {engines: {a: r('a', 'https://x.com/1', 'https://y.com/'), b: r('b', 'https://www.x.com/1/', 'https://z.com')}, n: 8});
  assert.deepEqual(results.map(x => x.url), ['https://x.com/1', 'https://y.com/', 'https://z.com']);
});

test('one engine failing still returns the other, with the error reported', async () => {
  const {results, errors} = await search('q', {engines: {a: async () => { throw Error('rate limited'); }, b: r('b', 'https://ok.com')}});
  assert.equal(results.length, 1);
  assert.deepEqual(errors, ['rate limited']);
});

test('fallback runs only when the main engines return nothing', async () => {
  let used = false;
  const fallback = async () => { used = true; return [{title: 't', url: 'https://f.com', snippet: '', engine: 'bing'}]; };
  await search('q', {engines: {a: r('a', 'https://a.com')}, fallback});
  assert.equal(used, false);
  const {results} = await search('q', {engines: {a: r('a')}, fallback});
  assert.equal(used, true);
  assert.equal(results[0].url, 'https://f.com');
});
