# AnywhereCode

A Discord bot that gives your server a shared coding agent. Connect a GitHub
repo, type `/code <task>` in any channel, and AnywhereCode works in a thread —
streaming progress, taking mid-task instructions from anyone in the thread —
then opens a pull request.

```
/code <task>     spawns a thread, agent works, streams progress, opens a PR
/ask <question>  repo-aware Q&A, read-only
/repo set        pick the active repo for a channel
/status          running and queued tasks
/cancel          stop the task in this thread
/config role     choose who may invoke the agent (default: admins)
```

## How it works

```
Discord ⇄ apps/bot (discord.js + fastify + orchestrator)
              │ Drizzle → Postgres
              │ dockerode → ephemeral container per task (apps/runner)
              │                 │ Claude Agent SDK, git clone/push
              │                 └ egress only via allowlist proxy
              └ octokit → GitHub App (installation tokens, PRs, merges)
```

- **GitHub App, not PATs**: users grant per-repo access in GitHub's own UI;
  tokens are short-lived installation tokens scoped to one repo per task;
  PRs show up as `AnywhereCode[bot]`; revoking = uninstalling the app.
- **Container per task**: the repo is cloned into an ephemeral Docker
  container (`apps/runner`), worked on, pushed, destroyed. Repo code never
  enters the bot process. Containers run with dropped capabilities, resource
  limits, and (in production) a network whose only exit is an allowlist proxy
  (`infra/egress-proxy`) permitting Anthropic + GitHub only.
- **Branch + PR only**: the runner pushes to `anywherecode/<task-id>`; the
  bot opens the PR. Nothing ever pushes to your default branch.
- **Threads are shared sessions**: anyone replying in the task thread is
  heard by the agent mid-task, with their username attached.

## Setup

### 1. Discord application

Create an app at <https://discord.com/developers/applications>, add a bot,
enable the **Message Content** intent, and grab the bot token + client id.
Invite URL scopes: `bot applications.commands`; permissions: Send Messages,
Create Public Threads, Send Messages in Threads, Embed Links, Read Message
History.

### 2. GitHub App

Register at <https://github.com/settings/apps/new>:

- **Name**: AnywhereCode (the slug goes in `GITHUB_APP_SLUG`)
- **Permissions**: Contents *Read & write*, Pull requests *Read & write*,
  Metadata *Read-only*
- **Setup URL**: `${PUBLIC_URL}/github/setup` and check
  *Redirect on update*
- Generate a private key; webhooks can stay disabled for v1.

### 3. Run it

```sh
cp .env.example .env       # fill it in
docker compose up -d       # postgres + egress proxy
pnpm install
pnpm --filter @anywherecode/bot db:migrate
pnpm --filter @anywherecode/bot register-commands
docker build -f apps/runner/Dockerfile -t anywherecode-runner .
pnpm --filter @anywherecode/bot start
```

`PUBLIC_URL` must be reachable by GitHub for the install redirect (for local
development use cloudflared or ngrok).

### 4. Onboarding (what your users see)

1. Bot joins → posts a welcome message with a **Connect GitHub** button.
2. Button → GitHub App install page → user picks repos.
3. GitHub redirects back, the guild is linked, bot posts "Ready".
4. `/repo set`, then `/code` away.

## Development

```sh
pnpm -r typecheck   # strict TS across the workspace
pnpm -r test        # vitest: protocol, signing, renderer, gates
pnpm dev            # bot with tsx watch
```

Layout: `packages/shared` defines the NDJSON protocol between bot and runner
(`TaskSpec` in, `RunnerEvent` out). `apps/bot` owns Discord, Postgres, GitHub,
and container lifecycles behind a `Workspace` interface (swap `DockerWorkspace`
for Fly Machines/Firecracker later). `apps/runner` wraps the Claude Agent SDK
behind an `Agent` interface (other engines later).

## v1 limits (by design)

One running task per server; monthly task caps (`/code` and a looser one for
`/ask`); platform API key only (no BYO keys yet); no dashboard or billing;
GitHub-hosted repos only.
