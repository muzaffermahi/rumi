# Contributing to Rumi

Thanks for helping. Rumi is small enough to read in an afternoon, and every part of it can be tested without an API key.

## Set up

You need [Node 22.19+](https://nodejs.org) and git.

```bash
git clone https://github.com/muzaffermahi/rumi.git
cd rumi
npm ci
npm run build
npm run dev          # the server, on http://127.0.0.1:4317
```

`npm run dev` prints nothing about a token: open Rumi with `node bin/rumi.mjs` once, which unlocks your browser, or run `node bin/rumi.mjs link`. A checkout keeps its data in `./data` (ignored by git), so it never touches the `~/.rumi` of an installed copy. Set `RUMI_DATA` to use another folder.

For interface work, run the server and the hot-reloading interface side by side:

```bash
npm run dev          # terminal 1
npm run dev:web      # terminal 2, then open http://localhost:5173
```

The dev interface forwards `/api` to the server with your access token.

### Building Rumi with Rumi

Use an installed Rumi (`~/.rumi` data) to work on this checkout, so a task that builds or tests Rumi never touches the Rumi you're using. Build tasks read [AGENTS.md](AGENTS.md). When a change is ready:

```bash
npm run try              # this checkout on port 4400, beside your Rumi, with test data in .rumi-try/
npm run adopt            # your Rumi becomes this checkout; open pages offer to reload
npm run adopt -- --undo  # back to the version before
```

The first `npm run adopt` with no installed Rumi installs one from the checkout.

## Checks

```bash
npm run check        # lint, types, server and API tests, interface tests
npm run test:e2e     # a real browser against a real server (needs `npx playwright install chromium` once)
```

All of them run against a **scripted fake model** (`test/fixtures/fake-model.mjs`), so they are free, fast and the same every time. If a change needs new model behaviour, teach the fake model a new marker rather than calling a real one.

`npm run probe` runs a real model through search, files, the shell, steering, the hand-back and cancellation, and `npm run verify:proof` checks its evidence. Use it when you change how workers run (it spends a little of your model's quota).

CI runs the checks on Windows, macOS and Linux with Node 22 and 24, the end-to-end tests, and starts the packaged build with only its own Node.

## Where things are

[ARCHITECTURE.md](ARCHITECTURE.md) walks through the code. In short: `server/` is the local server, `web/` the interface, `pi/` Rumi's worker extension, kinds, saved instructions and skills, `bin/rumi.mjs` the command.

## Style

- Biome formats and lints (`npm run format`, `npm run lint`). Single quotes, no bracket spacing, 160 columns.
- Comments say *why*, in plain sentences, at the top of a module and above anything surprising. Match the files around your change.
- Words in the interface are short, specific and kind: "Couldn't save. Your text is kept; try again." rather than "Error 500".
- No new runtime dependency without a reason in the pull request.

## Commits and pull requests

- Use [conventional commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`, `docs: …`, `refactor: …`, `test: …`, `chore: …`. The changelog and version numbers are made from them.
- Keep a pull request to one change. Say what it changes for someone using Rumi, and how you checked it. Screenshots for anything visible.
- New behaviour comes with a test. Bug fixes come with the test that would have caught them.

## Releasing (maintainers)

Merging to `main` keeps a release pull request up to date (release-please). Merging that tags the release; the Release workflow builds the downloads for each system, attaches them with checksums, publishes `rumi-app` to npm (when `NPM_TOKEN` is set) and updates the Homebrew tap and Scoop bucket (when `TAP_TOKEN` is set).

## Code of conduct

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
