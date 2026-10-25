// A real-model check of the worker: streaming, search, page reading, a file, the shell, steering, the hand-back
// (finish) and cancellation. Writes its evidence to pi-proof.json; `npm run verify:proof` checks it.
// Model: RUMI_MODEL=provider/id, else Rumi's default model.
import fs from 'node:fs';
import path from 'node:path';
import {loadRuntime, makeSession, taskDir} from './runtime.mjs';
import {settings} from './lib/workspaces.mjs';
import {KINDS} from './pi/kinds.mjs';

await loadRuntime();
const out = taskDir('proof');
fs.mkdirSync(out, {recursive: true});
const evidence = {version: '1.3.0', events: [], streamed: 0, outDir: out};
const ctl = {kind: 'build', searchMin: 0, budget: {used: 0, queries: new Set()}, cwd: out, outDir: out, contextWindow: 32768,
  turn: {expectFinish: true, requireResearch: false, finished: false, asked: false, nudged: {finish: 0, research: 0}},
  onFinish: h => { evidence.handback = h; }};
const {session: s} = await makeSession({ctl, modelRef: process.env.RUMI_MODEL || settings.defaultModel, kind: 'build', outDir: out, sessionsDir: path.join(out, 'sessions')});
evidence.tools = s.getActiveToolNames();
s.subscribe(e => {
  if (e.type === 'message_update' && e.assistantMessageEvent.type === 'text_delta') evidence.streamed++;
  if (['tool_execution_start', 'tool_execution_end', 'message_end'].includes(e.type)) evidence.events.push(e);
});
try {
  let steered = false;
  s.subscribe(e => { if (e.type === 'tool_execution_start' && !steered) { steered = true; s.steer('Correction: put STEERING_CONFIRMED at the end of your answer.'); evidence.steeringQueued = true; } });
  await s.prompt(`Use web_search to search for "Pi coding agent earendil works SDK". Read a result with read_page. Write a short cited summary to proof.txt using write, then use ${KINDS.build.tools.find(t => /shell|bash/.test(t))} to check that the file exists. Report actual failures if any, then call finish.`);
  evidence.answer = (evidence.handback?.answer || '') + '\n' + s.getLastAssistantText();
  evidence.sessionFile = s.sessionFile;
  ctl.turn = {expectFinish: false, requireResearch: false, finished: false, asked: false, nudged: {finish: 0, research: 0}};
  const run = s.prompt('Use the shell to run Start-Sleep -Seconds 30 (or sleep 30), then say finished.');
  await new Promise(resolve => { const unsub = s.subscribe(e => { if (e.type === 'tool_execution_start') { unsub(); resolve(); } }); setTimeout(resolve, 15000); });
  await s.abort();
  await run;
  evidence.cancelled = true;
} catch (e) { evidence.error = e.message; }
finally {
  s.dispose();
  fs.writeFileSync('pi-proof.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({streamed: evidence.streamed, steering: evidence.steeringQueued, handedBack: !!evidence.handback, cancelled: evidence.cancelled, error: evidence.error}));
}
