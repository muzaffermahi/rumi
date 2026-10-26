<div align="center">

<img src="public/favicon.svg" width="64" alt="" />

# rumi

**Stop prompting and waiting. Keep thinking, and let agents work in the margins.**

A writing workspace where you hand any passage to an AI worker with one keystroke, keep writing,<br/>
and find the answer waiting beside the passage it belongs to.

[![CI](https://github.com/muzaffermahi/rumi/actions/workflows/ci.yml/badge.svg)](https://github.com/muzaffermahi/rumi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-1f7a68)](LICENSE)
![Local-first](https://img.shields.io/badge/local--first-no%20telemetry-555)
![Node 22.19+](https://img.shields.io/badge/node-22.19%2B-555)

<img src="docs/suggestion.png" alt="A plan in Rumi with three delegated passages. Each one's status sits in the margin, and one answer is open beside its passage." width="900" />

</div>

## The problem with prompt, wait, read, repeat

Working with AI today mostly means taking turns. You write a prompt, then you wait. You read what comes back, write the next prompt, and wait again. Every turn pulls your attention out of your own thinking and into the agent's. Run three agents and you're juggling three chat windows. Your ideas end up scattered across conversations, and the clearest picture of what you're doing lives in a transcript you'll never reread.

**Rumi turns this around.** You stay in one document: your plan, your argument, your notes, whatever you're thinking through. When a passage needs research, a rewrite, a critique or a code change, you hand just that passage to a worker and **keep writing**. There's no turn to wait for. The answer comes back beside the passage it's about, and you take it in when you get there.

## What changes when you work this way

- **You stay at the centre.** The document is yours and it's the real work. Agents serve it, and nothing they produce lands in it unless you put it there.
- **Your thinking gets clearer.** Writing *is* thinking, and you never stop doing it. Delegating makes you say exactly what each passage needs, and the answers arrive where they make sense, not in a separate feed.
- **Many agents, one calm view.** Every task is pinned to the words it's about, so the document itself is your dashboard: what's running, what's done and what needs you, at a glance and in context.
- **The document is the brief.** Every worker reads the whole document, so saying what you're making, who it's for and how you like things done briefs every task at once.
- **Workers you can leave alone.** They know you aren't watching. They assume and note instead of stopping to ask, hand back material written for your document rather than chat, and ask one clear question only when they truly can't go on.

## How it feels

**1. Write.** Get your thinking onto the page. Rough is fine.

**2. Delegate.** Select a passage and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>↵</kbd> on a Mac). Pick **Research**, **Write**, **Think** or **Build**, or a saved instruction like *Fact-check* or *Shorten*. Add a line about what you want, or don't.

<img src="docs/delegate.png" alt="The Delegate box over a selected passage, with kinds of help, saved instructions, an instruction and a model picker" width="900" />

**3. Keep writing.** The passage gets a soft highlight and its task's status sits in the margin. Delegate the next thing, and the next. Tasks run side by side in the background.

**4. Review when you're ready.** The margin says *1 suggestion*. Insert the answer below the passage, take only the part you select, dismiss it, or **replace the passage and see exactly what changed, word by word**. Every change is one undo away, and Rumi keeps a version of your text from before it.

<img src="docs/replace.png" alt="A suggested rewrite shown as a word-by-word diff against the original passage, with Insert below, Replace passage and Dismiss" width="900" />

**5. Talk to it if you want to.** Every task keeps its conversation beside the document: push back, steer it while it runs, or see exactly what it was sent and what it did.

<img src="docs/conversation.png" alt="A task's conversation open beside the document, showing the request and the answer it handed back" width="900" />

## Install

Rumi comes with its own Node, so there's nothing else to install. It runs on macOS (Apple silicon and Intel), Linux (x64 and arm64) and Windows.

**macOS and Linux**

```bash
curl -fsSL https://github.com/muzaffermahi/rumi/releases/latest/download/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://github.com/muzaffermahi/rumi/releases/latest/download/install.ps1 | iex
```

**Or download it** from the [latest release](https://github.com/muzaffermahi/rumi/releases/latest), unzip it and open **Rumi** (`Rumi.command` on a Mac, `rumi.sh` on Linux, `Rumi.cmd` on Windows). Rumi isn't signed with an Apple certificate yet, so the first time a Mac will ask you to allow it in System Settings → Privacy & Security → Open Anyway. The one-line installer doesn't need this.

**From source** (Node 22.19+)

```bash
git clone https://github.com/muzaffermahi/rumi.git
cd rumi && npm ci && npm run build && npm link
```

Then run `rumi` in any folder. Rumi opens in your browser, in that folder's workspace. The first screen connects a model, whichever you prefer:

- **An API key** from Anthropic (Claude), OpenAI, OpenRouter, Google and many more. You pay the provider for what you use.
- **A subscription you already pay for:** sign in with ChatGPT, GitHub Copilot, Grok and others. (Claude subscriptions work only in Anthropic's own apps, so for Claude, use an API key.)
- **A model on your own computer** with Ollama, LM Studio or any OpenAI-compatible server. Free and fully private.

If you use [Pi](https://pi.dev), Rumi can share its sign-ins.

## What's inside

| | |
|---|---|
| **Writing** | Many documents per workspace, tables, checklists, highlighted code, images, outline, focus mode, a slash menu, Markdown import and export, version history |
| **Delegating** | Research (searches the web with no API key and cites sources), Write, Think, Build, saved instructions, any connected model per task |
| **Reviewing** | Answers beside their passage: insert, replace with a word diff, take a part, or dismiss; run a task again on another model and compare |
| **Build tasks** | In a project folder: edit files and run commands, checkpointed so you can review the diff and revert in one click, or run on their own git branch |
| **Staying in control** | Commands after a web read wait for your approval; workers can't reach your computer or local network; non-Build tasks can't change your project |
| **Extending** | Your own task kinds and saved instructions as Markdown files, Pi packages and MCP servers per workspace, Brave, Tavily or SearXNG search |
| **Getting around** | Command palette, keyboard shortcuts, light and dark themes, `rumi` in a terminal, `rumi delegate` from scripts |

<table>
<tr>
<td width="50%"><img src="docs/palette.png" alt="The command palette, listing commands, documents and tasks" /></td>
<td width="50%"><img src="docs/dark.png" alt="Rumi in dark mode, with an answer open beside its passage" /></td>
</tr>
<tr>
<td align="center"><sub>Everything is one <kbd>Ctrl</kbd>+<kbd>K</kbd> away</sub></td>
<td align="center"><sub>Light and dark</sub></td>
</tr>
</table>

## The command line

```bash
rumi                      # open Rumi on this folder
rumi delegate "Find three recent studies on spaced repetition" --kind research --wait
rumi status               # running? which port, which models
rumi doctor               # check everything Rumi needs, with fixes
rumi setup                # connect local models, open the sign-in screen
rumi update               # update the way you installed it
rumi stop
```

`rumi --help` lists everything. Settings live in `~/.rumi/config.json` (with a [JSON schema](schema/config.schema.json)); `rumi config set theme dark` changes one.

## Privacy

Rumi runs on your computer. No account, no server of ours, no telemetry. Your documents go only to the model you choose, as context for the tasks you delegate. The local server only answers this computer's browser, with an access token. [SECURITY.md](SECURITY.md) explains what each kind of task can touch.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md). The whole test suite runs against a scripted model, so it needs no API keys. See [CHANGELOG.md](CHANGELOG.md) for what's new.

<div align="center">
<br/>
<sub>MIT licensed. Built on <a href="https://pi.dev">Pi</a>. Named after the poet who wrote about the field beyond right and wrong; here, it's the space between thinking and delegating.</sub>
</div>
