// Reads a task's conversation from Pi's persisted session instead of keeping a second history.
import fs from 'node:fs';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {parseUserPrompt} from './context.mjs';

const textOf = content =>
  typeof content === 'string'
    ? content
    : (content || [])
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');
const brief = (value, max = 600) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
};

// Session entries (active branch, oldest first) -> chronological items:
//   {role:'user', kind, text, passage?, context?}
//   {role:'assistant', text, tools:[{name, args, result, isError}], offers?:[{file, title}], error?, model?}
//   {role:'note', text}
// Consecutive assistant/tool messages between two user messages form one response.
export function toConversation(entries) {
  const items = [];
  let reply = null;
  const toolsById = new Map();
  for (const e of entries) {
    if (e.type === 'compaction') {
      items.push({role: 'note', text: 'Earlier messages were compacted by Pi to save context.'});
      reply = null;
      continue;
    }
    // Rumi's own nudges before a run settles (see pi/extension.mjs).
    if (e.type === 'custom_message' && e.customType === 'rumi-check') {
      items.push({
        role: 'note',
        kind: 'check',
        text:
          e.details?.reason === 'research'
            ? `Rumi asked for more research (${e.details.searches ?? 0} searches so far)`
            : 'Rumi asked the worker to hand back its result',
      });
      reply = null;
      continue;
    }
    if (e.type !== 'message') continue;
    const m = e.message;
    if (m.role === 'user') {
      items.push({role: 'user', at: m.timestamp, ...parseUserPrompt(m.content)});
      reply = null;
    } else if (m.role === 'assistant') {
      if (!reply) {
        reply = {role: 'assistant', at: m.timestamp, text: '', tools: []};
        items.push(reply);
      }
      reply.model = `${m.provider}/${m.model}`;
      for (const c of m.content || []) {
        if (c.type === 'text' && c.text.trim()) reply.text += (reply.text ? '\n\n' : '') + c.text.trim();
        if (c.type === 'toolCall') {
          const tool = {name: c.name, args: brief(c.arguments, 300)};
          if (c.name === 'offer_document')
            tool.offer = {
              file: String(c.arguments?.file || '')
                .split(/[\\/]/)
                .pop(),
              title: c.arguments?.title,
              reply,
            };
          // The hand-back and the agent's question are shown as part of the reply once they succeed.
          if (c.name === 'finish')
            tool.handback = {
              answer: c.arguments?.answer || '',
              summary: c.arguments?.summary || '',
              notes: c.arguments?.notes || '',
              assumptions: c.arguments?.assumptions || [],
              reply,
            };
          if (c.name === 'ask_user')
            tool.question = {question: c.arguments?.question || '', options: c.arguments?.options || [], why: c.arguments?.why || '', reply};
          reply.tools.push(tool);
          toolsById.set(c.id, tool);
        }
      }
      if (m.stopReason === 'error') reply.error = m.errorMessage || 'The model returned an error.';
      if (m.stopReason === 'aborted') reply.aborted = true;
    } else if (m.role === 'toolResult') {
      const tool = toolsById.get(m.toolCallId);
      if (tool) {
        tool.result = brief(textOf(m.content));
        tool.isError = !!m.isError;
        // A successful offer_document call becomes an "open it here" button on that reply.
        if (tool.offer) {
          const {reply: r, ...offer} = tool.offer;
          delete tool.offer;
          if (!m.isError) (r.offers ||= []).push(offer);
        }
        if (tool.handback) {
          const {reply: r, ...h} = tool.handback;
          delete tool.handback;
          if (!m.isError) r.handback = h;
        }
        if (tool.question) {
          const {reply: r, ...q} = tool.question;
          delete tool.question;
          if (!m.isError) r.question = q;
        }
      }
    }
  }
  return items;
}

export function readSessionEntries(file, liveSession) {
  if (liveSession) return liveSession.sessionManager.getBranch();
  if (!file || !fs.existsSync(file)) return null;
  return SessionManager.open(file).getBranch();
}

// v1 tasks without a readable Pi session: show what was stored rather than inventing a timeline.
export function legacyConversation(t) {
  const items = [
    {role: 'note', text: 'This task predates conversation history. Showing its stored instruction, corrections and latest result.'},
    {role: 'user', kind: 'delegation', text: t.objective, passage: t.source || null, context: true},
  ];
  for (const u of t.updates || []) items.push({role: 'user', kind: 'message', text: u.text});
  if (t.result) items.push({role: 'assistant', text: t.result, tools: [], legacy: true});
  return items;
}
