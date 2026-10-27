# How Rumi works

Rumi is a local web app: a Node server (`server/`) that runs AI workers through the [Pi SDK](https://pi.dev), and a React interface (`web/`) in your browser. The code follows the loop a person goes through: **write, delegate, work, review.**

```text
 browser (web/)                         server (server/)                           Pi SDK
┌───────────────────────┐   HTTP   ┌──────────────────────────────┐        ┌─────────────────┐
│ App.tsx               │ ───────▶ │ app.mjs  → routes/*.mjs       │        │ one session per │
│  DocumentPane (TipTap)│          │ workspaces.mjs  documents     │        │ task: model,    │
│  Margin · TaskPane    │ ◀─────── │ context.mjs     what's sent   │ ─────▶ │ tools, retries, │
│  Sidebar · Settings   │   SSE    │ worker.mjs      queue, runs   │        │ compaction,     │
└───────────────────────┘          │ live.mjs        snapshots     │ ◀───── │ sessions (JSONL)│
                                   └──────────────────────────────┘        └─────────────────┘
                                         │                │                    ▲
                                    SQLite per       git checkpoints     pi/extension.mjs:
                                    workspace        (server/git.mjs)    Rumi's tools and checks
```

## 1. Write

- **Workspaces** (`server/workspaces.mjs`): the Global one (in Rumi's data folder) and one per project folder (in `<project>/.rumi/`, ignored by git). Each has documents, tasks and the packages and MCP servers turned on for it.
- **Storage** (`server/store.mjs`): a small key/value table in SQLite per workspace (`node:sqlite`, no native module), plus folders for Pi's sessions and each task's output files.
- **Documents**: stored as the editor's HTML with a version history (a snapshot every ten minutes of writing, and one before Rumi changes the document for you). Saves carry the revision they started from; a save from a stale tab is refused (409) and the interface offers to keep either version. `server/documents.mjs` converts to and from Markdown, HTML and text.
- **The editor** (`web/editor/`): TipTap with tables, checklists, highlighted code, images (uploaded to the workspace), a slash menu and an outline. Delegated passages carry a `taskLink` mark (`web/taskLink.ts`), so links survive edits and reloads.

## 2. Delegate

- The Delegate box (`web/DocumentPane.tsx`) sends the selection, its offset, the instruction, the kind and the model to `POST /api/w/:wid/tasks`.
- **Kinds** (`pi/kinds/*.md`, loaded by `pi/kinds.mjs`): front matter for the tools, thinking level and minimum searches; the body is the guide the worker reads. Users add their own in `~/.rumi/kinds/` and `<project>/.rumi/kinds/`. **Saved instructions** (`pi/presets/`, `server/presets.mjs`) work the same way.
- **What the worker is sent** (`server/context.mjs`): the instruction, the passage, the kind's guide, the project folder's README, and the document as clearly labelled background (cut to the text around the passage when long, with the full text saved as a file). Each supply is recorded, so *Context supplied* shows exactly what was sent.

## 3. Work

- **The queue** (`server/queue.mjs`, `server/worker.mjs`): tasks start oldest first, up to the configured number at once; only Build tasks hold their project folder. A second Build task in a busy git repository starts anyway on its own worktree, made from the folder as it is (uncommitted files included) and applied back file by file with `git merge-file`; elsewhere it waits.
- **Sessions** (`server/runtime.mjs`): one Pi session per task, with Rumi's own Pi home (`~/.rumi/pi`) so it never changes the user's Pi setup, the kind's tools, opted-in Pi packages and MCP servers (Pi's MCP extension, tools exposed directly), and Rumi's worker prompt (`pi/prompt.mjs`). Rumi never substitutes a model: a session that opens on another one is refused.
- **Rumi's extension** (`pi/extension.mjs`, `pi/tools.mjs`): `web_search` (engines from `server/search.mjs`), `read_page` (through `server/net.mjs`, which refuses local and private addresses), `finish`, `ask_user`, `offer_document`; a check before a run settles that the worker handed back (and searched enough, for research); approval for shell commands after a web read; and a guard that keeps non-Build tasks writing only in their task folder.
- **Build tasks** (`server/git.mjs`): a checkpoint of the project before and after each run, in a separate git repository (`.rumi/checkpoints.git`) whose work tree is the project, so it works in any folder and never touches the user's repository. Optionally, a git worktree and branch per task, merged or discarded from the task pane.
- **Staying alive**: model errors are retried with backoff by Pi; a run with no events is marked stalled, and restarted once automatically after ten minutes.

## 4. Review

- **Live updates** (`server/live.mjs`): every page follows one workspace over server-sent events; snapshots are batched (150 ms) and carry tasks, settings (without secrets), kinds, saved instructions and the version.
- **The margin** (`web/Margin.tsx`): each linked passage's status; a finished task's answer as a card to insert, replace (with a word diff, `web/diff.ts`), take in part, or dismiss. Every change is one undo step with a saved version before it.
- **The task pane** (`web/TaskPane.tsx`): the conversation read from Pi's session file, steering, the Build task's changes (`web/Changes.tsx`), and answers from other models side by side.

## Around the loop

| Area | Where |
|---|---|
| Settings (`~/.rumi/config.json`, validated, schema in `schema/`) | `server/config.mjs` |
| Access token, Host and Origin checks | `server/auth.mjs` |
| Models and sign-ins from the browser | `server/connections.mjs`, `web/Connect.tsx` |
| `rumi` command | `bin/rumi.mjs` (and `server/doctor.mjs`, `server/update.mjs`) |
| Folder pickers (Windows, macOS, Linux, in-browser) | `server/folders.mjs`, `web/FolderChooser.tsx` |
| Rumi as a Pi package (`/rumi` in Pi, Rumi's skills) | `pi/cli.mjs`, `pi/skills/` |
| Downloads with their own Node, installers, manifests | `scripts/package.mjs`, `install/`, `scripts/manifests.mjs` |

## Tests

- `test/*.test.mjs` (Node's test runner): modules, and the HTTP API end to end against a real server and a **scripted fake model** (`test/fixtures/fake-model.mjs`).
- `web/*.test.tsx` (Vitest, jsdom): interface pieces.
- `e2e/*.spec.mjs` (Playwright): the loop in a real browser.
- `scripts/probe.mjs`: a real model, run by hand when changing how workers run.
