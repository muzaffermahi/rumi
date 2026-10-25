# Verification — v2, 24 October 2026

Runtime: Node 24.14.1; Pi SDK 1.3.0; `lmstudio/tiel-coder-35b-a3b` served locally. Tested on a copy of the v1 data (port 4318), then switched the real workspace to v2.

`npm test` (20 tests): context construction and truncation, v1 prompt reconstruction, queue limits and project-folder serialisation, throttling, conversation reading from real v1 Pi sessions, Markdown HTML stripping.

Against the running app:

- v1 data migrated additively (backup written to `data/backups/`); all v1 tasks open as conversations from their Pi sessions.
- Delegated the last paragraph of a five-paragraph document with Ctrl+Enter; the reply used the date, place and times from the first paragraphs. Focus returned to the editor; the task did not open itself.
- Follow-up while idle and a later message continued the same session; the pane shows one chronological conversation with Markdown links.
- Editing the document after delegation sent nothing (same message and context counts). *Update document context* while idle travelled with the next message (answer used the new venue); during a run it was steered in (answer used the new meeting point).
- Three tasks at limit 2: two ran, the third queued. A steering message showed as Queued, was delivered, and was obeyed. Stopping one running task left the other running and started the queued one. With limit 1, the second task waited.
- A task created with `opencode/deepseek-v4.1-flash-free` recorded that model in its Pi session and called that provider; OpenCode refused its free tier outside its own app and Rumi showed the 403 instead of substituting. Unknown models are rejected at delegation.
- Hard-killed and restarted the server: 9 tasks, 9 unique, identical message and context counts.
- During streaming (62 task-pane DOM updates) the editor kept focus, caret and scroll position while typing.
- Output file opens as text, downloads, and *Insert* placed its formatted Markdown after the caret's paragraph; path traversal and `.rumi-document.txt` return 404.
- At 390 px the Document / Tasks switch works without horizontal scrolling and preserves the document's scroll position.

# Verification — v1, 24 October 2026

Runtime: Node 24.14.1; pinned @earendil-works/pi-coding-agent 1.3.0; LM Studio `tiel-coder-35b-a3b`.

`node verify-proof.mjs` passed against a real persisted Pi session:

- 96 streamed text deltas.
- `web_search` returned URLs through Bing Search RSS.
- `read_page` extracted https://pi.dev/ with Mozilla Readability.
- `write` created proof.txt, then Pi's PowerShell tool confirmed existence and 1,024 bytes.
- `session.steer()` delivered a correction; the response included STEERING_CONFIRMED.
- `session.abort()` stopped a subsequent PowerShell sleep, with an actual aborted tool result.
- Pi's JSONL session file exists. Automatic compaction remains Pi-managed and enabled; compaction was not forced in this short session.

Browser verification at http://127.0.0.1:4317:

- Wrote a repair-café idea in TipTap, selected it with keyboard input, and delegated it.
- Continued writing a second paragraph while the task status was Running; editor focus stayed in the document.
- Received a useful plan beside the document.
- Continued the same task, sent a live correction, saw Update queued, and received a campus-room plan ending ROOM_READY at revision 4.
- Explicitly inserted that result into the document.
- Started another run and used Stop task; the card became Cancelled.
- Restarted Node and refreshed the browser: the document and a single copy of the task with its corrections/status were restored.

`npm run build` passes. Vite reports a non-blocking bundle-size warning. Node reports that its SQLite API is experimental.

Search relevance is variable: Bing returned the official Pi site for the SDK probe, but initially returned irrelevant results for a Repair Café query. Failed/empty searches and fetches are exposed to the worker, rather than reported as successful verification.

Final browser research check: delegated the repair-café passage, used search and direct official-page extraction, wrote `plan.txt`, and verified it through Pi's PowerShell tool. Clicked its download link in the browser; the downloaded file's SHA-256 matched the generated file. Restarted Node again and reopened the completed result successfully.
