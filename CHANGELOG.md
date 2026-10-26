# Changelog

All notable changes to Rumi. From 0.5.0 on, this file is kept by release-please from conventional commit messages.

## 0.5.0 (2026-10-26)

The release that turns Rumi from a prototype into a tool you can install, trust and extend.

### Install and setup
- Install with one line (`install.sh`, `install.ps1`), with `npm install -g rumi-app`, or from Homebrew and Scoop manifests; every download carries its own Node and a checksum.
- The `rumi` command gains `status`, `logs`, `doctor`, `setup`, `update`, `config`, `link` and `delegate`, and picks the next free port when 4317 is taken.
- A welcome document and a three-step first-run guide; macOS and Linux folder pickers and an in-browser folder browser.
- Settings move to `~/.rumi/config.json`, with a JSON schema and per-project overrides in `.rumi/config.json`.
- Rumi can be installed as its own window (web app manifest and icons). Fonts are bundled, so it works offline.

### Writing
- Many documents per workspace: create, rename, archive, delete, import Markdown, HTML or text, export Markdown, HTML, text or PDF.
- Version history with preview and restore; a version is saved before Rumi changes your document.
- Saving from an out-of-date tab no longer overwrites newer text: you choose which version to keep.
- Slash menu, tables, checklists, highlighted code, images, outline, word count and focus mode.
- Command palette (`Ctrl+K`), keyboard shortcut sheet (`?`), customisable shortcuts, dark mode.

### Delegating and reviewing
- Saved instructions (Fact-check, Shorten, Find sources…), and your own as Markdown files.
- Replace a passage with a word-level diff, insert only the part you select, and undo any change in one step.
- Run a task again on another model and compare the answers side by side.
- Tasks show tokens, cost and time; archive, delete, search and filter them; browser notifications when they finish or need you.
- The project brief field is gone: every task reads your whole document, so the document is the brief. The welcome document explains how.

### Build tasks
- Each Build task is checkpointed: review its diff and revert it in one click (and undo the revert).
- Optional git worktree per Build task, merged or discarded when you choose.
- Shell commands after reading a web page wait for your approval.

### Extending
- Custom task kinds as Markdown files (yours and per project).
- MCP servers, defined once and turned on per workspace.
- Search with Brave, Tavily or SearXNG alongside the keyless engines, with a test search in Settings.
- Browse and install Pi packages from Settings, optionally without their install scripts.
- Any OpenAI-compatible local server, besides LM Studio and Ollama.

### Security
- The local API needs an access token, so other programs and users can't start tasks.
- Workers can't open addresses on your computer or local network (including Rumi itself).
- Research, Write and Think tasks can no longer write files in your project, only in their task folder.
- Sign-in and settings files are written readable only by you.

### Models
- Setup leads with API keys, then ChatGPT and Copilot sign-in, then local models. Claude subscription sign-in is no longer offered, and Claude models signed in with a subscription (for example through shared Pi sign-ins) are not used: Anthropic's terms allow Claude subscriptions only in Claude Code and Claude.ai. Claude works with an Anthropic API key.

### Fixes
- Local models that report token usage no longer fail with "Cannot read properties of undefined (reading 'tiers')".
- Keys typed right after naming a new document no longer land in its title.
- Plain-text conversion no longer splits text at the letters "E000".

### For contributors
- MIT license, contributing guide, code of conduct, security policy, issue and pull request templates.
- Biome formatting and linting, strict TypeScript for the interface, and CI on Windows, macOS and Linux.
- A scripted fake model, so the API, interface and end-to-end tests need no API keys.
- Code reorganised into `server/`, `web/` and `scripts/`; see ARCHITECTURE.md.

## 0.4.0 (2026-10-25)
- Workers that hand back with `finish`, ask with `ask_user`, and are noticed when they stall.
- Rumi as a Pi package (`/rumi` command and skills); per-workspace Pi packages.
- Sign in from the browser with subscriptions, API keys or local servers; share sign-ins with Pi.
- Downloads for Windows, macOS and Linux with their own Node.

## 0.2.0 (2026-10-24)
- Project folder workspaces, task kinds, conversations per task, steering, document context updates.

## 0.1.0 (2026-10-24)
- First version: delegate a passage from the editor and get the result beside it.
