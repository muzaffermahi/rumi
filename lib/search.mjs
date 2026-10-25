// Keyless web search. Exa's hosted MCP endpoint (free tier, no key; approach from @bytetrue/pi-web-search)
// and DuckDuckGo's HTML endpoint are queried together and merged; Bing HTML is the fallback.
import {JSDOM} from 'jsdom';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const text = html => clean(JSDOM.fragment(`<div>${html}</div>`).textContent);

export async function exa(query, n, signal) {
  const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'};
  const post = async (body, sid) => {
    const r = await fetch('https://mcp.exa.ai/mcp', {method: 'POST', signal, headers: sid ? {...headers, 'Mcp-Session-Id': sid} : headers, body: JSON.stringify(body)});
    if (!r.ok) throw Error(r.status === 429 ? 'Exa free tier is rate-limited right now' : `Exa HTTP ${r.status}`);
    const raw = await r.text();
    const data = raw.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).at(-1) ?? raw;
    return {json: data ? JSON.parse(data) : {}, sid: r.headers.get('mcp-session-id') || sid};
  };
  const init = await post({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'rumi', version: '2'}}});
  if (!init.sid) throw Error('Exa did not start a session');
  await post({jsonrpc: '2.0', method: 'notifications/initialized', params: {}}, init.sid).catch(() => {});
  const call = await post({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'web_search_exa', arguments: {query, numResults: n}}}, init.sid);
  const out = call.json.result?.content?.find(c => c.type === 'text')?.text || '';
  const results = [];
  for (const block of out.split(/\n---+\n/)) {
    const at = block.search(/^Highlights:/m);
    if (at < 0) continue; // only blocks with a header; page text inside highlights is never parsed as a result
    const head = block.slice(0, at);
    const title = head.match(/^Title:\s*(.+)$/m)?.[1], url = head.match(/^URL:\s*(https?:\/\/\S+)$/m)?.[1];
    const published = head.match(/^Published:\s*(\S+)/m)?.[1]?.slice(0, 10);
    if (title && url) results.push({title: clean(title), url, snippet: clean(block.slice(at + 11)).slice(0, 500), published, engine: 'exa'});
  }
  return results;
}

export async function duckduckgo(query, n, signal) {
  const r = await fetch('https://html.duckduckgo.com/html/', {method: 'POST', signal, headers: {'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({q: query})});
  if (!r.ok) throw Error(`DuckDuckGo HTTP ${r.status}`);
  const doc = new JSDOM(await r.text()).window.document;
  return [...doc.querySelectorAll('.result')].filter(el => !el.classList.contains('result--ad')).map(el => {
    const a = el.querySelector('a.result__a');
    let url = a?.getAttribute('href') || '';
    const target = url.match(/[?&]uddg=([^&]+)/)?.[1];
    if (target) url = decodeURIComponent(target);
    return {title: clean(a?.textContent), url, snippet: clean(el.querySelector('.result__snippet')?.textContent).slice(0, 400), engine: 'duckduckgo'};
  }).filter(x => x.title && /^https?:\/\//.test(x.url)).slice(0, n);
}

export async function bing(query, n, signal) {
  const r = await fetch(`https://www.bing.com/search?${new URLSearchParams({q: query, form: 'QBLH'})}`, {signal, headers: {'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'}});
  if (!r.ok) throw Error(`Bing HTTP ${r.status}`);
  const results = [];
  for (const raw of (await r.text()).split(/<li class="b_algo"/i).slice(1, n + 1)) {
    const m = raw.match(/<h2\b[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) continue;
    let url = m[1].replace(/&amp;/g, '&');
    const u = url.includes('bing.com/ck/a') && new URL(url).searchParams.get('u');
    if (u) url = Buffer.from(u.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const snippet = raw.match(/<p class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (/^https?:\/\//.test(url)) results.push({title: text(m[2]), url, snippet: snippet ? text(snippet).slice(0, 400) : '', engine: 'bing'});
  }
  return results;
}

const key = url => { try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '')).toLowerCase(); } catch { return url; } };

// Merges engines, alternating so each contributes its best results first, and drops duplicate URLs.
export async function search(query, {n = 8, signal, engines = {exa, duckduckgo}, fallback = bing} = {}) {
  const timed = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(25000)]);
  const settled = await Promise.allSettled(Object.values(engines).map(f => f(query, n, timed)));
  const lists = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
  const errors = settled.filter(s => s.status === 'rejected').map(s => s.reason?.message || String(s.reason));
  if (!lists.some(l => l.length)) {
    try { lists.push(await fallback(query, n, timed)); } catch (e) { errors.push(e.message); }
  }
  const seen = new Set(), merged = [];
  for (let i = 0; merged.length < n && lists.some(l => l[i]); i++)
    for (const l of lists) if (l[i] && !seen.has(key(l[i].url)) && merged.length < n) { seen.add(key(l[i].url)); merged.push(l[i]); }
  return {results: merged, errors};
}
