// Starts a real Rumi server on a throwaway data folder, connected only to the fake model (never your sign-ins).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function startRumi({modelPort, provider = 'fake', modelId = 'scripted', port = 43000 + Math.floor(Math.random() * 4000), config = {}} = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rumi-test-'));
  fs.mkdirSync(path.join(data, 'pi'), {recursive: true});
  fs.writeFileSync(
    path.join(data, 'pi', 'connections.json'),
    JSON.stringify({mode: 'rumi', local: [{id: provider, name: provider, baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'none', models: [modelId]}]}),
  );
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({defaultModel: `${provider}/${modelId}`, updateCheck: false, maxWorkers: 2, ...config}));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(appDir, 'server', 'app.mjs')], {
    cwd: appDir,
    env: {...process.env, RUMI_DATA: data, RUMI_PORT: String(port), RUMI_NO_UPDATE_CHECK: '1', RUMI_MODEL_RETRIES: '0'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => (log += d));
  child.stderr.on('data', d => (log += d));
  for (let i = 0; i < 300; i++) {
    await sleep(150);
    if (child.exitCode !== null) throw Error(`Rumi exited:\n${log}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) break;
    } catch {}
  }
  if (!fs.existsSync(path.join(data, 'server.json')))
    throw Error(`Rumi did not start in 45 s:
${log}`);
  const {token} = JSON.parse(fs.readFileSync(path.join(data, 'server.json'), 'utf8'));
  const base = `http://127.0.0.1:${port}`;
  async function api(url, {method = 'GET', body, auth = true, headers = {}} = {}) {
    const r = await fetch(`${base}/api${url}`, {
      method,
      headers: {'Content-Type': 'application/json', ...(auth ? {Authorization: `Bearer ${token}`} : {}), ...headers},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => null);
    return {status: r.status, body: json};
  }
  // Polls a task until it settles (or the condition holds).
  async function until(taskId, done = t => !['queued', 'running'].includes(t.status), ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const {body} = await api(`/tasks/${taskId}/summary`);
      if (body && done(body)) return body;
      await sleep(200);
    }
    throw Error(`Task ${taskId} did not settle in time.\n${log.slice(-2000)}`);
  }
  async function stop() {
    child.kill();
    await sleep(300);
    fs.rmSync(data, {recursive: true, force: true, maxRetries: 5});
  }
  return {port, token, data, base, api, until, stop, log: () => log};
}
