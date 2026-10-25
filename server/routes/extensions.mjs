// What workers can be given beyond their kind's tools: Pi packages, MCP servers, and the web search engines.
import express from 'express';
import * as host from '../runtime.mjs';
import {config, publicConfig, saveConfig} from '../config.mjs';
import {savePackages, saveMcp, workspaces} from '../workspaces.mjs';
import {broadcast} from '../live.mjs';
import {dropIdleSessions} from '../worker.mjs';
import {checkEngines} from '../search.mjs';
import {fail, handle} from './common.mjs';

const router = express.Router();

// --- Pi packages (installed in Rumi's own Pi home; enabled per workspace) ---
router.get('/packages', (q, r) =>
  r.json({installed: config.packages, fromPi: host.piPackages().filter(p => !config.packages.some(x => x.source === p.source))}),
);
router.get(
  '/packages/search',
  handle(async (q, r) => r.json({results: await host.searchPackages(String(q.query.q || ''))})),
);
router.post('/packages', async (q, r) => {
  const name = String(q.body?.name || '').trim();
  if (!/^(npm:|git:|https?:)?[@\w./:#-]+$/.test(name)) return r.status(400).json({error: 'Enter a package name, like pi-lens.'});
  try {
    const p = await host.installPackage(host.packageSource(name), {ignoreScripts: !!q.body?.ignoreScripts});
    config.packages = [...config.packages.filter(x => x.source !== p.source), {source: p.source, name: p.name, version: p.version, description: p.description}];
    saveConfig();
    broadcast();
    r.json({installed: config.packages});
  } catch (e) {
    fail(r, 400, Error(`Could not install ${name}: ${e.message}`));
  }
});
router.delete('/packages', async (q, r) => {
  const source = q.body?.source;
  try {
    await host.removePackage(source);
  } catch {}
  config.packages = config.packages.filter(p => p.source !== source);
  saveConfig();
  for (const ws of workspaces.values())
    if (ws.packages.includes(source))
      savePackages(
        ws,
        ws.packages.filter(s => s !== source),
      );
  dropIdleSessions();
  broadcast();
  r.json({installed: config.packages});
});

// --- MCP servers (defined once in config.json, turned on per workspace) ---
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
function checkServer(s) {
  if (!s || typeof s !== 'object') return 'Describe the server as an object.';
  if (s.url) {
    if (!/^https?:\/\//.test(s.url)) return 'url must start with http:// or https://.';
    if (s.headers && typeof s.headers !== 'object') return 'headers must be an object.';
  } else if (typeof s.command !== 'string' || !s.command.trim()) return 'Give either a command (a program to run) or a url.';
  if (s.args && (!Array.isArray(s.args) || s.args.some(a => typeof a !== 'string'))) return 'args must be a list of strings.';
  if (s.env && typeof s.env !== 'object') return 'env must be an object.';
  return null;
}
router.get('/mcp', (q, r) => r.json({servers: publicConfig().mcpServers}));
router.put('/mcp/:name', (q, r) => {
  const name = q.params.name;
  if (!NAME.test(name)) return r.status(400).json({error: 'Names may use letters, digits, - and _.'});
  const raw = q.body?.server;
  const error = checkServer(raw);
  if (error) return r.status(400).json({error});
  const allowed = ['command', 'args', 'env', 'cwd', 'url', 'headers', 'description', 'timeout', 'oauth'];
  config.mcpServers = {...config.mcpServers, [name]: Object.fromEntries(Object.entries(raw).filter(([k]) => allowed.includes(k)))};
  saveConfig();
  dropIdleSessions();
  broadcast();
  r.json({servers: publicConfig().mcpServers});
});
router.delete('/mcp/:name', (q, r) => {
  config.mcpServers = Object.fromEntries(Object.entries(config.mcpServers).filter(([n]) => n !== q.params.name));
  saveConfig();
  for (const ws of workspaces.values())
    if (ws.mcp.includes(q.params.name))
      saveMcp(
        ws,
        ws.mcp.filter(n => n !== q.params.name),
      );
  dropIdleSessions();
  broadcast();
  r.json({servers: publicConfig().mcpServers});
});

// --- search ---
router.get(
  '/search/check',
  handle(async (q, r) => r.json({engines: await checkEngines(config.search)})),
);

export default router;
