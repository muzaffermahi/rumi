<div align="center">

# rumi

**Keep writing. Let agents work in the margins.**

Rumi is a writing workspace for people who make things.<br/>
When a passage needs research, a draft or a fix, hand it to an agent and keep going.<br/>
The answer comes back beside the passage it belongs to, whenever you're ready to look.

<br/>

<img src="docs/linked-passages.jpg" alt="Rumi: a document with two delegated passages, highlighted, with each task's status in the margin" width="820"/>

<br/>
<br/>

![local-first](https://img.shields.io/badge/local--first-3a5240?style=flat-square)
![no API keys for search](https://img.shields.io/badge/web%20search-no%20API%20keys-6d8c61?style=flat-square)
![agents by Pi](https://img.shields.io/badge/agents-Pi%20SDK-a9b79c?style=flat-square)
![node 22+](https://img.shields.io/badge/node-22%2B-dedfd6?style=flat-square)

</div>

---

## Who it's for

Rumi is for people who do ambitious work and think by writing: founders shaping a product, researchers working through a question, engineers planning a project before and while they build it, anyone starting something from scratch.

You don't have to be a hardcore programmer, and you don't want another chat window. You want one place where your thinking lives, and help that doesn't pull you out of it.

## The idea

Most AI tools run on a loop: prompt, wait, read, prompt again. Your attention goes to the agent and whatever it produces. Rumi turns that around.

- **Your writing is the work.** The document is both the centre and the end product. Agents serve it. Their answers are raw material you choose to use, not the thing you're making.
- **Delegate, don't wait.** Handing off a passage takes one keystroke and puts you straight back on the page. Nothing opens by itself, and nothing takes your focus.
- **Calm, not a control room.** Delegated work is pinned to the passages it came from. You can see what's running and what's waiting at a glance, without a wall of agent chatter.
- **Honest by default.** You can see exactly what each agent was sent, which model it ran on and what it did. Rumi never swaps your model for another, and never reports a check that didn't happen.

## The loop

**1. Write.** Get your thinking onto the page: the plan, the open questions, the half-formed ideas.

**2. Delegate.** Select a passage and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>↵</kbd> on macOS), or click the Delegate button that appears next to the selection. Pick the kind of help (**Research**, **Write**, **Think**, or **Build** in a project folder), say what you want, or leave it blank. With nothing selected, the task covers the whole document.

**3. Keep writing.** The passage gets a soft highlight, and its task's status sits in the margin. Move on to the next thought, and delegate again if you like. Tasks run in the background. If a worker truly can't go on without you, its passage says *Needs you*, and you answer right there.

**4. Review when you're ready.** A finished task hands back an answer written for your document, not a chat reply. It waits beside its passage as a suggestion, with its sources and assumptions folded underneath. Insert it below the passage, dismiss it, or open the conversation to push back.

<img src="docs/suggestion.jpg" alt="A finished task's answer shown as a suggestion under its passage" width="820"/>

## Get started

**Without a terminal.** Download the zip for your computer from [Releases](https://github.com/muzaffermahi/rumi/releases), unzip it, and double-click **Rumi**. Your browser opens on a short setup screen:

- **Sign in with a subscription you already have**: ChatGPT, Claude Pro/Max, SuperGrok or X Premium, GitHub Copilot, Kimi Code, OpenRouter. A browser tab opens and you sign in; nothing is copied by hand.
- **Or paste an API key** (OpenCode Go and Zen, OpenRouter, Anthropic, OpenAI, Google, DeepSeek, xAI and more).
- **Or use a model on this computer** with LM Studio or Ollama. Rumi finds them if they're running.
- **Already use Pi?** Rumi offers to share Pi's sign-ins, so whatever you connected there works here too.

Nothing else to install: the download carries its own copy of Node.

**From source.** You need [Node 22+](https://nodejs.org).

```bash
git clone https://github.com/muzaffermahi/rumi.git
cd rumi
npm ci && npm run build
npm link            # installs the `rumi` command
```

Then, from any project:

```bash
cd ~/code/my-project
rumi
```

Rumi starts in the background and opens in your browser, inside that project. `rumi stop` shuts it down.

**From Pi.** `pi install git:github.com/muzaffermahi/rumi` adds a `/rumi` command that opens Rumi on the folder you're in, and Rumi's writing skills to Pi.

## Workers you can leave alone

Delegating only works if you can stop watching. Rumi's workers are built for that.

- **They know where they are.** Every worker is told how Rumi works: you are writing, not watching; assume and note rather than stop and ask; hand back material, not chat. Each task gets the project's brief (see *This project*) and, in a code folder, its `README` and `AGENTS.md`.
- **They hand back properly.** A task is done when the worker calls *finish* with an answer, a one-line summary, sources and assumptions. If a worker stops without it, Rumi asks it once to finish properly. Research tasks that ran too few searches are sent back to search more.
- **They ask when they must.** A worker that can't go on without you asks one question, with suggested answers, and pauses. Its slot goes to other tasks until you reply.
- **They don't get lost.** Model errors are retried with backoff. A worker that stops making progress is marked *stalled* with a *Restart step* button; after ten silent minutes Rumi restarts the step itself, once.
- **Each kind gets only the tools it needs.** Research, Write and Think tasks can search the web and write files in their task folder, but can't run commands or edit your project. Build tasks can, inside the project folder.

## In more detail

**Workspaces.** Every project folder has its own document, brief and tasks, stored in `<project>/.rumi/` and ignored by git. There's also a Global workspace for everything else. Switch from the top of the sidebar, or just run `rumi` in another folder.

**This project.** A few lines under the workspace name saying what the project is, who it's for and what matters. Every task in the workspace gets them.

**Edits are noticed.** Rewrite a delegated passage and its badge says *changed since delegated*. Nothing is sent until you press *Send new version*.

**One conversation per task.** Messages steer a running task or continue a finished one, in the same Pi session. Tool use stays folded away. To see what the agent is doing (its thinking, the command it's running and that command's latest output), click the live *Working…* line.

**Context you can check.** Each task gets the instruction, the passage, and your whole document, clearly labelled as background rather than instructions. Long documents are cut to the text around the passage, and the agent is told so. *Context supplied* shows exactly what was sent.

**Research without keys.** Web search merges Exa's free endpoint with DuckDuckGo. Research tasks plan first and run 5 to 30 distinct searches.

**Your models.** Connect them in *Settings → Models and sign-ins*. Pick a default, override it for a single task, and run up to three tasks at a time. *Reasoning* can be turned off for small local models.

**Pi packages.** Rumi runs on [Pi](https://pi.dev), so community packages work in it: extensions that add tools, and skills that teach workers a way of working. Add one by name in Settings (packages you installed in Pi are suggested). Rumi keeps its own copy, and you turn it on per workspace, so a code-checking package like `pi-lens` can serve your code projects without touching your writing. Rumi ships four skills of its own: a research brief, writing in your voice, a sharp critique, and turning notes into a plan. Your personal skills in `~/.agents/skills` are offered too if you allow it.

**Your Pi setup stays yours.** Rumi keeps its own Pi home (`pi/` inside its data folder) and never loads or changes your Pi settings, extensions or skills. The only thing it can share is sign-ins, and only if you choose *Share with Pi*.

## Under the hood

| | |
|---|---|
| Editor | React + [TipTap](https://tiptap.dev). Links between passages and tasks are a mark stored in the document itself |
| Agents | [Pi SDK](https://pi.dev): sessions, steering, compaction, retries, cancellation, skills, packages, sign-ins |
| Storage | SQLite + Pi's JSONL sessions, per workspace |
| Live updates | Server-sent events, batched |
| Search | Exa (free, keyless) + DuckDuckGo HTML, Bing fallback; Readability for pages |

The code follows the loop:

```text
lib/workspaces.mjs   write: workspaces, documents, the project brief
lib/context.mjs      delegate: what a worker is sent
lib/worker.mjs       work: the queue, Pi sessions, hand-backs, questions, stalls
lib/live.mjs         review: what the page shows, updated live
lib/connections.mjs  models and sign-ins, from the browser
runtime.mjs          Rumi's Pi host: its own Pi home, models, skills, packages
pi/                  Rumi as a Pi package: worker prompt, kinds, tools, skills, the /rumi command
server.mjs           the HTTP API
src/                 the interface (document, margin, task pane, setup)
bin/rumi.mjs         the `rumi` command
scripts/package.mjs  the no-terminal download (Node included), built for each platform by CI
```

`npm test` runs the test suite. `npm run probe` runs a real model through search, files, the shell, steering, the hand-back and cancellation; `npm run verify:proof` checks the evidence.

## Good to know

- **Local and trusted.** Agents run on your computer. Research, Write and Think tasks can't run commands, but Build tasks can, and Pi packages you enable run with your permissions. A task folder is a working location, not a sandbox.
- **No time limits.** A task runs until it finishes or you press Stop. After a restart, unfinished tasks wait for you to resume them.
- **Same-folder tasks run one at a time** unless you allow side-by-side runs in Settings.
- **Tested on Windows.** The folder picker uses Windows' native dialog. Elsewhere, paste a path or run `rumi` in the folder.

<div align="center">
<br/>
<sub>Built on <a href="https://pi.dev">Pi</a>. Named after the poet who wrote about the field beyond right and wrong. Here, it's the space between thinking and delegating.</sub>
</div>
