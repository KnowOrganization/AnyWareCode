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
- **Secret handling**: tokens reach the container over stdin, never as env
  vars (which `docker inspect` exposes). The GitHub token is scoped to one repo
  and fed to git via `GIT_ASKPASS`, so it never lands in the remote URL,
  `.git/config`, or process args, and is never put on the runner's environment
  where the agent's tools would inherit it. *Caveat:* the Anthropic key must be
  in the SDK subprocess's environment, so a prompt-injected agent could read it
  — the egress allowlist limits exfiltration, and per-task scoped keys are the
  planned hardening.
- **Unforgeable, single-use install links**: the GitHub-App `state` is HMAC
  signed and backed by a short-lived, one-time DB nonce, and the returned
  `installation_id` is verified against the App — a captured link can't be
  replayed or paired with someone else's installation.
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

### 3. Database (Supabase)

Create a project at <https://supabase.com>. From **Project Settings → Database
→ Connection string**, copy the **Session pooler** (or Direct) URI into
`DATABASE_URL` and set `DATABASE_SSL=true`. Migrations run against the same URL.

For purely local dev you can instead use the bundled Postgres
(`docker compose up -d postgres`) with `DATABASE_SSL=false`.

### 4. Run it

```sh
cp .env.example .env        # fill it in (DATABASE_URL, DATABASE_SSL, tokens…)
corepack enable             # provides pnpm
pnpm install

# Local DB only (skip if using Supabase): docker compose up -d postgres
docker compose up -d egress-proxy        # prod egress allowlist (optional in dev)

pnpm --filter @anywherecode/bot db:migrate
pnpm --filter @anywherecode/bot register-commands
docker build -f apps/runner/Dockerfile -t anywherecode-runner .
pnpm --filter @anywherecode/bot start
```

`PUBLIC_URL` must be reachable by GitHub for the install redirect (for local
development use cloudflared or ngrok).

### 5. Invite the bot

Open the OAuth2 invite URL (scopes `bot applications.commands`) from the Discord
developer portal and add it to your server. It posts a welcome message with a
**Connect GitHub** button.

### 6. Onboarding (what your users see)

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
