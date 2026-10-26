// A scripted, OpenAI-compatible model server for tests: no keys, no network, the same answer every time.
// It streams chat completions and decides its next step from the conversation so far:
//   • the task mentions [ask]    → it asks the user (ask_user), then finishes once answered
//   • the task mentions [build]  → it writes hello.txt in its working directory, then finishes
//   • the task mentions [stall]  → it waits 60 s before answering (for stop/restart tests)
//   • the task mentions [error]  → it returns an HTTP 500
//   • otherwise                  → it finishes straight away with "FAKE ANSWER: <the passage>"
// After a tool result for finish or ask_user it ends the turn with one short line.
import http from 'node:http';

// The welcome tour's example question gets a realistic answer, so screenshots of it read naturally.
const WELCOME_ANSWER = {
  answer:
    '**Write at the same time each day.** A fixed slot turns writing into a habit rather than a decision; Robert Boice found that academics who wrote briefly every day produced far more than those who waited for long sessions.\n\n**Keep the bar low.** Aim for a small daily amount (a few hundred words or twenty minutes) so that missing a day feels unlikely.\n\n**Track it visibly.** A simple log or streak calendar gives the quick feedback that keeps a new routine going.',
  summary: 'Three daily-writing habits, with the evidence',
  notes: 'Sources: Boice, R. (1990) *Professors as Writers*; Silvia, P. (2007) *How to Write a Lot*.',
};

// Answers for the demo document the README screenshots are taken from (e2e/screenshots.spec.mjs).
const DEMO_ANSWERS = [
  [
    'The club will meet',
    {
      answer:
        'The club meets on the first Thursday of each month at the town library, 7–8:30 pm. Each month we read one short book or a handful of essays, chosen by a member in turn, so nobody needs to buy much and newcomers can join any month.',
      summary: 'Tighter, with the details a newcomer needs',
      assumptions: ['The library room is free on first Thursdays'],
    },
  ],
  [
    'How do other reading clubs',
    {
      answer:
        '- **Keep it small.** Groups of 8–12 give everyone time to speak; larger clubs split into tables.\n- **Rotate the choice.** Letting each member pick in turn keeps the list varied and shares the work.\n- **Offer a way in.** A short first read and a few printed questions make the first evening easy for new members.\n- **Meet somewhere free.** Libraries often lend rooms to reading groups at no cost.',
      summary: 'Four practices from established reading clubs',
      notes: 'Sources: library reading-group guides and organisers’ write-ups (demo data).',
    },
  ],
  [
    'Risks',
    {
      answer:
        'The biggest risk is attendance fading after the first few months. Plan for it: confirm the next date at the end of each meeting, keep a short list of members who can host if the library room falls through, and check in after three months on whether the format still suits people.',
      summary: 'Attendance is the main risk; three ways to plan for it',
    },
  ],
];

const lastUser = messages => [...messages].reverse().find(m => m.role === 'user');
const text = c => (typeof c === 'string' ? c : (c || []).map(p => p.text || '').join(''));

function decide(body) {
  const messages = body.messages || [];
  const tools = new Set((body.tools || []).map(t => t.function?.name));
  const task = text(messages.find(m => m.role === 'user' && text(m.content).includes('<rumi-task>'))?.content) || text(lastUser(messages)?.content);
  const last = messages.at(-1);
  const passage = task.match(/<rumi-passage>[\s\S]*?"""\n([\s\S]*?)\n"""/)?.[1]?.trim() || 'the whole document';
  if (last?.role === 'tool') {
    const call = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.tool_calls)
      ?.tool_calls?.at(-1);
    const name = call?.function?.name;
    if (name === 'write')
      return {tool: 'finish', args: {answer: 'Wrote hello.txt in the project.', summary: 'Added hello.txt', notes: 'Checked by reading it back.'}};
    return {text: name === 'ask_user' ? 'Waiting for your answer.' : 'Handed back.'};
  }
  if (last?.role === 'user' && !text(last.content).includes('<rumi-task>') && task.includes('[ask]')) {
    return {tool: 'finish', args: {answer: `FAKE ANSWER after your reply: ${text(last.content).slice(0, 60)}`, summary: 'Answered after asking'}};
  }
  if (task.includes('[ask]') && tools.has('ask_user'))
    return {tool: 'ask_user', args: {question: 'Formal or casual?', options: ['Formal', 'Casual'], why: 'The tone changes everything.'}};
  if (task.includes('[build]') && tools.has('write')) return {tool: 'write', args: {path: 'hello.txt', content: 'hello from the fake model\n'}};
  if (tools.has('finish') && passage.includes('three habits')) return {tool: 'finish', args: WELCOME_ANSWER};
  for (const [key, args] of DEMO_ANSWERS) if (tools.has('finish') && passage.includes(key)) return {tool: 'finish', args};
  if (tools.has('finish'))
    return {tool: 'finish', args: {answer: `FAKE ANSWER: ${passage.slice(0, 200)}`, summary: 'A fake answer', assumptions: ['This is a test']}};
  return {text: 'FAKE REPLY'};
}

function stream(res, step, model) {
  res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
  const id = `chatcmpl-${Date.now()}`;
  const chunk = (delta, finish = null) =>
    res.write(
      `data: ${JSON.stringify({id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{index: 0, delta, finish_reason: finish}]})}\n\n`,
    );
  chunk({role: 'assistant', content: ''});
  if (step.text) {
    for (const word of step.text.split(/(?<= )/)) chunk({content: word});
    chunk({}, 'stop');
  } else {
    const callId = `call_${Math.random().toString(36).slice(2, 10)}`;
    chunk({tool_calls: [{index: 0, id: callId, type: 'function', function: {name: step.tool, arguments: ''}}]});
    chunk({tool_calls: [{index: 0, function: {arguments: JSON.stringify(step.args)}}]});
    chunk({}, 'tool_calls');
  }
  res.write(
    `data: ${JSON.stringify({id, object: 'chat.completion.chunk', model, choices: [], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}})}\n\n`,
  );
  res.end('data: [DONE]\n\n');
}

export function startFakeModel(port = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({object: 'list', data: [{id: 'scripted', object: 'model'}]}));
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404);
      return res.end();
    }
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push(body);
      const task = text(body.messages?.find(m => m.role === 'user' && text(m.content).includes('<rumi-task>'))?.content);
      if (task.includes('[error]')) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        return res.end(JSON.stringify({error: {message: 'The fake model was asked to fail.'}}));
      }
      const go = () => stream(res, decide(body), body.model || 'scripted');
      if (task.includes('[stall]') && body.messages.at(-1)?.role === 'user') {
        const timer = setTimeout(go, 60_000);
        req.on('close', () => clearTimeout(timer));
      } else if (process.env.FAKE_MODEL_DELAY)
        setTimeout(go, Number(process.env.FAKE_MODEL_DELAY)); // for the demo recording
      else go();
    });
  });
  return new Promise(resolve =>
    server.listen(port, '127.0.0.1', () => resolve({port: server.address().port, requests, close: () => new Promise(r => server.close(r))})),
  );
}

// `node test/fixtures/fake-model.mjs 4399` runs it on its own (for the end-to-end tests and manual checks).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const {port} = await startFakeModel(Number(process.argv[2]) || 4399);
  console.log(`Fake model on http://127.0.0.1:${port}/v1`);
}
