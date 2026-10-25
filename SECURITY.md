# Security and privacy

## Reporting a problem

Please report security problems privately, through GitHub's [private vulnerability reporting](https://github.com/muzaffermahi/rumi/security/advisories/new), not in a public issue. You'll get a reply within a few days. Include what you found, how to reproduce it, and which version (`rumi --version`).

## How Rumi is built to be safe

Rumi runs on your computer. There is no account and no server of ours; nothing about you is collected. The only network requests Rumi makes on its own are a daily version check to GitHub (turn it off in Settings → Privacy) and installing packages you choose. Everything else is your model provider, the web pages workers read, and the search engines you turned on.

### The local server

- It listens only on `127.0.0.1`.
- It refuses requests whose `Host` or `Origin` isn't Rumi's own, which stops other websites and DNS rebinding.
- Every API request needs Rumi's access token, kept in `~/.rumi/server.json` (readable only by you). The `rumi` command opens your browser with it; the server moves it into an HttpOnly, SameSite cookie. This stops other programs and other users on your computer from starting tasks.

### What tasks can touch

| Kind | Reads | Writes | Runs commands | Web |
|---|---|---|---|---|
| Research, Write, Think | its task folder and the project | its task folder | no | search and read pages |
| Build (project folders only) | the project | the project | yes | search and read pages |
| Your own kinds | as their file says | as their file says | only with `shell`, which needs a project folder | if listed |

A task folder is a place to work, not a sandbox: workers run with your permissions. Pi packages and MCP servers you enable run with your permissions too; only add ones you trust. Rumi can install packages without running their install scripts.

### Prompt injection

A web page a worker reads can contain text meant to steer it. Rumi limits what that can do:

- Workers can't open addresses on your computer or local network (including Rumi itself), checked at every redirect and against the address actually connected to. Settings → Privacy can allow it.
- In Build tasks, shell commands wait for your approval once the task has read a web page (Settings → Workers can make that *always* or *never*).
- Build tasks are checkpointed before they run, so their changes can be reviewed and reverted.

### Sign-ins and keys

Subscription sign-ins and API keys are stored by Pi in `auth.json` (Rumi's own copy in `~/.rumi/pi`, or Pi's if you chose to share). Search API keys are in `~/.rumi/config.json`. Both are written readable only by you; `rumi doctor` warns if they aren't. The interface never receives your keys back, only whether one is set.

## Supported versions

Security fixes go into the latest release. Update with `rumi update`.
