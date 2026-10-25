// Rumi's worker tools as Pi tool definitions: web search and page reading, offering a finished document, handing
// the result back (finish), asking the user a question (ask_user).
import fs from 'node:fs';
import path from 'node:path';
import {Type} from 'typebox';
import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';
import {search, enginesFor, UA} from '../server/search.mjs';
import {safeFetch} from '../server/net.mjs';

export const SEARCH_MAX = 30;
const timeout = (signal, ms = 25000) => AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(ms)]);
const text = s => ({content: [{type: 'text', text: s}]});

// budget: {used, queries:Set}, reset for every user message and shared by the session's searches.
// ctl.search: the search settings; ctl.allowPrivate: whether read_page may open local addresses.
export function webTools(ctl) {
  const {budget, searchMin = 0, contextWindow = 32768} = ctl;
  const pageChars = Math.max(6000, Math.min(18000, Math.round(contextWindow * 0.1 * 3))); // small reads for small contexts
  return [
    {
      name: 'web_search',
      label: 'Web search',
      description: `Search the web (several engines merged). Returns up to 8 results with title, URL and snippet. Each call is one search; you have ${SEARCH_MAX} per user message. Use distinct, specific queries.`,
      parameters: Type.Object({query: Type.String()}),
      async execute(_, p, signal) {
        const q = p.query.trim().replace(/\s+/g, ' '),
          norm = q.toLowerCase();
        if (budget.queries.has(norm)) throw Error(`You already searched "${q}" for this message. Use a different query or read the results you have.`);
        if (budget.used >= SEARCH_MAX)
          throw Error(`Search limit reached (${SEARCH_MAX} searches for this message). Finish with the sources you have and say what remains uncertain.`);
        const n = ++budget.used;
        budget.queries.add(norm);
        const {results, errors} = await search(q, {signal: timeout(signal), engines: enginesFor(ctl.search)});
        if (!results.length)
          throw Error(
            `No results${errors.length ? ` (${errors.join('; ')})` : ''}. Search ${n} of ${SEARCH_MAX} used. Try a different wording before giving up.`,
          );
        const engines = [...new Set(results.map(r => r.engine))].join(' + ');
        const more = n < searchMin ? ` — run at least ${searchMin - n} more distinct searches before concluding` : '';
        return {
          ...text(
            `Search ${n} of ${SEARCH_MAX}${more}. Engines: ${engines}.\n` +
              JSON.stringify(
                results.map(({engine, ...r}) => r),
                null,
                1,
              ),
          ),
          details: {engines, errors, used: n},
        };
      },
    },
    {
      name: 'read_page',
      label: 'Read page',
      description: 'Fetch and extract readable text from a public web page, one chunk at a time. Does not count as a search.',
      parameters: Type.Object({url: Type.String(), offset: Type.Optional(Type.Number({description: 'Character offset to continue a long page'}))}),
      async execute(_, p, signal) {
        const u = new URL(p.url);
        if (!['https:', 'http:'].includes(u.protocol)) throw Error('HTTP URL required');
        if (ctl.turn) ctl.turn.readWeb = true; // later shell commands in this run may need the user's approval
        const r = await safeFetch(u, {
          signal: timeout(signal, 30000),
          allowPrivate: !!ctl.allowPrivate,
          headers: {'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'},
        });
        if (!r.ok) throw Error(`Page HTTP ${r.status}`);
        const dom = new JSDOM(r.text, {url: r.url});
        const all = (new Readability(dom.window.document).parse()?.textContent || 'No readable content').replace(/\n{3,}/g, '\n\n');
        const from = Math.max(0, Math.floor(p.offset || 0)),
          chunk = all.slice(from, from + pageChars),
          more = from + chunk.length < all.length;
        return {
          ...text(
            chunk +
              (more
                ? `\n\n[Showing characters ${from}–${from + chunk.length} of ${all.length}. Call read_page with offset ${from + chunk.length} for more.]`
                : ''),
          ),
          details: {url: u.href, length: all.length},
        };
      },
    },
  ];
}

// ctl.cwd: where the worker works (a project folder or its task folder). ctl.outDir: the task folder Rumi shows files from.
// ctl.onFinish / ctl.onAsk report to Rumi; ctl.turn (replaced before every run) records what happened in this run.
export function rumiTools(ctl) {
  const {cwd, outDir} = ctl;
  const inside = (dir, file) => {
    const rel = path.relative(dir, file);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  return [
    {
      name: 'offer_document',
      label: 'Offer document',
      description:
        'Call this after you finish writing a document file the user should read (a report, plan, draft or analysis in .md or .txt). The user gets a button to open it beside the conversation. Call it once per finished document.',
      parameters: Type.Object({
        file: Type.String({description: 'Path of the document, relative to your working directory or absolute, e.g. report.md'}),
        title: Type.Optional(Type.String({description: 'Short human title'})),
      }),
      async execute(_, p) {
        const src = path.resolve(cwd, p.file.trim()),
          name = path.basename(src);
        if (!/\.(md|markdown|txt)$/i.test(name)) throw Error('Only .md, .markdown or .txt documents can be offered.');
        if (!inside(cwd, src) && !inside(outDir, src)) throw Error('Only documents in your working directory or task folder can be offered.');
        const file = path.join(outDir, name);
        // A document written inside a project is copied to the task folder so it opens beside the conversation.
        if (fs.existsSync(src) && fs.statSync(src).isFile() && path.resolve(file) !== src) fs.copyFileSync(src, file);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw Error(`${name} does not exist in your working directory. Write it first.`);
        return {...text(`Offered ${name} to the user.`), details: {file: name, title: p.title || name}};
      },
    },
    {
      name: 'finish',
      label: 'Finish',
      description:
        "Hand the result back to the user. Call this once the task is done; a task is not delivered without it. The answer is shown under the user's passage, ready to insert into their document. After calling it, end your turn with one short line.",
      parameters: Type.Object({
        answer: Type.String({
          description:
            'The result itself, in Markdown, written as material for the user\'s document (not a chat reply, no "Done"/"Here is"). Match the document\'s language and tone.',
        }),
        summary: Type.String({description: 'One line, at most 12 words, saying what the answer is. Shown in the margin.'}),
        notes: Type.Optional(Type.String({description: 'Sources (URLs), method, and anything the user should double-check. Markdown.'})),
        assumptions: Type.Optional(Type.Array(Type.String(), {description: 'Assumptions you made instead of asking'})),
        files: Type.Optional(Type.Array(Type.String(), {description: 'Names of files you produced in your working directory'})),
      }),
      async execute(_, p) {
        const answer = p.answer?.trim();
        if (!answer) throw Error('answer is empty. Put the result itself in answer.');
        ctl.turn.finished = true;
        ctl.onFinish?.({
          answer,
          summary: p.summary?.trim() || '',
          notes: p.notes?.trim() || '',
          assumptions: (p.assumptions || []).map(s => s.trim()).filter(Boolean),
          files: p.files || [],
          at: Date.now(),
        });
        return text('Handed back to the user. End your turn now with one short line.');
      },
    },
    {
      name: 'ask_user',
      label: 'Ask the user',
      description:
        'Ask the user one question when you cannot continue without them (missing access, or a choice only they can make that changes the whole result). Do not use it for permission or confirmation; assume and note instead. The question appears beside their passage; end your turn after asking. Their answer arrives as the next message.',
      parameters: Type.Object({
        question: Type.String({description: 'One clear question'}),
        options: Type.Optional(Type.Array(Type.String(), {description: 'Up to 4 short answers the user can pick from'})),
        why: Type.Optional(Type.String({description: 'One line: why you cannot continue without the answer'})),
      }),
      async execute(_, p) {
        const question = p.question?.trim();
        if (!question) throw Error('question is empty.');
        ctl.turn.asked = true;
        ctl.onAsk?.({
          question,
          options: (p.options || [])
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 4),
          why: p.why?.trim() || '',
          at: Date.now(),
        });
        return text('The question is with the user. End your turn now; their answer will arrive as the next message.');
      },
    },
  ];
}
