# Working on Rumi

Rumi is a local writing workspace where passages are delegated to AI workers. This file is for agents (and people) changing Rumi's own code. ARCHITECTURE.md explains how the pieces fit; CONTRIBUTING.md has the longer version of this.

## Never do these

- Don't start, stop or restart a Rumi server, and don't run `rumi`, `rumi stop`, `npm start`, `npm run adopt` or `npm run try`. The Rumi you are running in may be the one you would stop. The person tries and adopts your change themselves.
- Don't touch `data/`, `.rumi/`, `.rumi-try/` or `~/.rumi`: they hold the person's documents, sign-ins and tasks.
- Don't commit, push, tag or change git branches unless the task asks for it.

## Layout

- `server/`: the Node server (Express 5, ES modules, `.mjs`). `server/routes/` has the HTTP API; `worker.mjs` runs tasks on Pi sessions; `git.mjs` has checkpoints and worktrees; `live.mjs` sends snapshots to the browser over SSE.
- `web/`: the interface (React 19, TipTap 3, strict TypeScript, `.tsx`). Styles in `web/styles/`, colour tokens in `tokens.css`.
- `pi/`: what workers get: task kinds and saved instructions (Markdown with frontmatter), tools, the system prompt.
- `bin/rumi.mjs`: the `rumi` command. `scripts/`: packaging, try, adopt and other tooling.
- `test/`: Node test runner (`*.test.mjs`), including API tests against a real server and a scripted fake model (`test/fixtures/fake-model.mjs`). `web/*.test.tsx`: Vitest. `e2e/`: Playwright.

## Checks

Run these before handing back, and say which you ran:

```bash
npm run lint        # Biome
npm run typecheck   # web/ is strict TypeScript
npm test            # server and API tests, no API keys needed
npm run test:web    # interface tests
npm run build       # the interface builds
```

`npm run test:e2e` runs the browser tests. It needs Playwright's Chromium, or `RUMI_E2E_BROWSER` set to a Chrome you already have.

New behaviour gets a test: an API test for anything a person can do through the interface, a unit test for pure logic.

## Style

- Biome formats: single quotes, no bracket spacing, 160 columns. `npm run format` fixes it.
- Write like the surrounding code: a short comment above anything whose purpose isn't obvious, in plain words, no comment noise.
- Words people see are plain and short: no jargon, no exclamation marks. Say what happened and what to do next.
- Keep it local-first: no telemetry, nothing sent anywhere except to the model the person chose.

## Hand back

Say what you changed and why, which checks you ran and their results, and anything you couldn't check. To see the change, the person runs `npm run try` (this checkout beside their Rumi, with test data) and then `npm run adopt` (their own Rumi becomes this version; `npm run adopt -- --undo` goes back).
