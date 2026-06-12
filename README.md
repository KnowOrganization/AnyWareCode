# AnywhereCode

A Discord bot that gives your server a shared coding agent. Connect a GitHub
repo, type `/code <task>` in any channel, and AnywhereCode works in a thread —
streaming progress, taking mid-task instructions from anyone in the thread —
then opens a pull request.

```
/code <task>       spawns a thread, agent works, streams progress, opens a PR
/ask <question>    repo-aware Q&A, read-only
/connect llm       connect your LLM (Anthropic key, Claude subscription, or compatible provider)
/connect github    connect GitHub repos
/setup             show connection status and usage
/repo set          pick the active repo for a channel
/status            running and queued tasks
/cancel            stop the task in this thread
/config role       choose who may invoke the agent (default: admins)
```

## How it works

```
Discord ⇄ apps/bot (discord.js + fastify + orchestrator)
              │ Drizzle → Supabase (Postgres)
              │ dockerode → ephemeral container per task (apps/runner)
              │                 │ Claude Agent SDK, git clone/push
              │                 └ egress only via allowlist proxy
              └ octokit → GitHub App (installation tokens, PRs, merges)
```

Each Discord server connects its **own LLM credential** (bring your own key).
Supported: Anthropic API key, Claude Pro/Max subscription token (`claude setup-token`),
or any Anthropic-compatible endpoint (DeepSeek, LiteLLM proxy, etc.).

## Talk to the bot

Besides `/code` and `/ask`, you can **@mention the bot anywhere** with plain
language. It reads the recent conversation and decides what to do:

- **Chat** — questions answerable from the conversation get a normal reply.
  Open to everyone; costs one small LLM call on the server's credential
  (rate-limited per guild, doesn't touch the monthly task cap).
- **Explicit task** — `@AnywhereCode fix the login 500` starts a coding task
  immediately (same thread + PR flow as `/code`). Requires the same role as
  `/code` (`/config role`).
- **Inferred task** — tag the bot after a discussion without giving a direct
  command and it proposes the task it inferred, with **Run / Dismiss** buttons.
  Run re-checks permissions and caps for whoever clicks; proposals expire
  after `CHAT_PROPOSAL_TTL_MINUTES` (default 60).
- **In a finished task thread**, asking for more changes iterates on that
  thread's existing PR.

Only explicit `@` mentions trigger it — replies to bot messages, `@everyone`,
and `@here` are ignored. Mentions inside an *active* task thread are forwarded
to the running agent like any other reply.

---

## Local dev setup (step by step)

### Prerequisites

- Node.js >= 22 — `node --version`
- Docker Desktop running
- `corepack enable` (provides pnpm)

---

### Step 1 — Create a Discord application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name it (e.g. "AnywhereCode Dev").
3. **Bot** tab → **Add Bot** → copy the **Token** → this is `DISCORD_TOKEN`.
4. Same page → enable **Message Content Intent** under Privileged Gateway Intents.
5. **OAuth2 → General** → copy **Client ID** → this is `DISCORD_CLIENT_ID`.
6. **OAuth2 → URL Generator**: scopes = `bot` + `applications.commands`;
   permissions = Send Messages, Create Public Threads, Send Messages in Threads,
   Embed Links, Read Message History.
7. Copy the generated URL → open it → add the bot to your test server.

---

### Step 2 — Get a public URL

GitHub needs to redirect back to the bot after app installation.
For local dev, use a free Cloudflare Tunnel:

```sh
# Install once
brew install cloudflared

# Run before starting the bot (leave this terminal open)
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://something.trycloudflare.com` URL — this is your `PUBLIC_URL`.

> The tunnel URL changes each run. Update `PUBLIC_URL` in `.env` and the GitHub App's Setup URL if it changes.

---

### Step 3 — Create a GitHub App

1. Go to <https://github.com/settings/apps/new>.
2. Fill in:
   - **GitHub App name**: `AnywhereCode` (or any name; the slug in the URL = `GITHUB_APP_SLUG`)
   - **Homepage URL**: your `PUBLIC_URL` from Step 2
   - **Callback URL**: `{PUBLIC_URL}/github/user-callback` — used by `/link github`
     (provenance identity linking). Also click **Generate a new client secret**:
     copy the **Client ID** → `GITHUB_CLIENT_ID` and the secret →
     `GITHUB_CLIENT_SECRET`. (Leave both env vars unset to disable linking.)
   - **Setup URL**: `{PUBLIC_URL}/github/setup` — check **Redirect on update**
   - **Webhook → Active**: **check** and set:
     - **Webhook URL**: `{PUBLIC_URL}/github/webhook`
     - **Webhook secret**: a random string (>=16 chars) → `GITHUB_WEBHOOK_SECRET`
       in `.env`. (Leaving both unset disables webhook features: issue feed,
       auto-review, ship-log auto-post, proactive previews.)
3. **Repository permissions**:
   - Contents: **Read & write**
   - Pull requests: **Read & write**
   - Issues: **Read-only**
   - Deployments: **Read-only**
   - Commit statuses: **Read-only**
   - Checks: **Read-only**
   - Metadata: **Read-only** (required automatically)
   Then under **Subscribe to events**: check **Issues**, **Pull request**,
   **Deployment status**, **Installation** (so GitHub-side uninstalls clean up
   the Discord-side links). (Existing installations must approve any
   permission change from their installation settings page.)

   > A server can link **multiple installations** — its members' personal
   > accounts and any orgs. `/connect github` always offers an "install on
   > another account or org" link; GitHub's own picker lists the orgs you
   > admin. Unlink with `/connect github remove:<login>`.
4. **Where can this GitHub App be installed?**: Any account
5. Click **Create GitHub App**.
6. On the app page:
   - Copy **App ID** → `GITHUB_APP_ID`
   - Copy the slug from the URL (`/apps/your-slug`) → `GITHUB_APP_SLUG`
   - Scroll down → **Generate a private key** → download `.pem` file
   - Open the `.pem`, copy contents → `GITHUB_APP_PRIVATE_KEY`
     (replace literal newlines with `\n` for the env file)

---

### Step 4 — Create a Supabase project

1. Go to <https://supabase.com> → **New project**.
2. Once created: **Project Settings → Database → Connection string**.
3. Copy the **Session pooler** URI → this is `DATABASE_URL`.
4. Set `DATABASE_SSL=true`.

---

### Step 5 — Set up the environment

```sh
cp .env.example .env
```

Open `.env` and fill in:

```env
DISCORD_TOKEN=           # from Step 1
DISCORD_CLIENT_ID=       # from Step 1

GITHUB_APP_ID=           # from Step 3
GITHUB_APP_SLUG=         # from Step 3 (e.g. anywherecode)
GITHUB_APP_PRIVATE_KEY=  # contents of the .pem, with \n for newlines

PUBLIC_URL=              # https://something.trycloudflare.com from Step 2

STATE_SECRET=            # openssl rand -base64 24
CREDENTIAL_SECRET=       # openssl rand -base64 48

DATABASE_URL=            # Supabase Session pooler URI from Step 4
DATABASE_SSL=true

# Leave these for dev:
RUNNER_NETWORK=
RUNNER_HTTPS_PROXY=
```

Generate the secrets:
```sh
openssl rand -base64 24   # paste as STATE_SECRET
openssl rand -base64 48   # paste as CREDENTIAL_SECRET
```

---

### Step 6 — Build the runner and start the bot

```sh
corepack enable
pnpm install

# Build the runner Docker image (from repo root)
docker build -f apps/runner/Dockerfile -t anywherecode-runner .

# Start the bot (tsx watch — auto-reloads on file changes)
pnpm dev
```

The bot will:
- Run DB migrations against Supabase automatically
- Register slash commands with Discord
- Log `Logged in as AnywhereCode#xxxx` when ready

> **Runner changes**: `pnpm dev` only reloads the bot. After editing anything in
> `apps/runner/` or `packages/shared/`, rebuild the runner image:
> `docker build -f apps/runner/Dockerfile -t anywherecode-runner .`

---

### Step 7 — Connect GitHub and LLM in your server

With the bot running in your test server:

1. The bot posts a welcome message with **Connect GitHub** and **Connect LLM** buttons.
2. Click **Connect GitHub** → install the GitHub App on a repo.
3. Click **Connect LLM** → pick a provider:
   - **Claude subscription**: run `claude setup-token` locally, paste the token
   - **Anthropic API key**: paste your `sk-ant-api-...` key
   - **Other provider**: paste base URL + key + model name
4. Run `/repo set` in a channel → pick a repo.
5. Type `/code fix the typo in README` — done.

---

### Useful commands during dev

```sh
pnpm -r typecheck                            # TypeScript check across all packages
pnpm -r test                                 # run all tests (vitest)
pnpm dev                                     # bot with hot reload
pnpm --filter @anywherecode/bot test gates   # single test file
pnpm --filter @anywherecode/bot db:generate  # after editing db/schema.ts
```

---

## Production (one command)

```sh
cp .env.example .env   # fill in all values
docker compose up -d --build
```

Builds and starts: bot, runner image, egress proxy. DB is Supabase — no local Postgres.
Bot runs migrations and registers commands automatically on boot.

### Optional production features

- **MCP extensions** (`/connect mcp`): set `MCP_HOST_ALLOWLIST` to the hostnames
  admins may attach, AND add a matching regex line for each host to
  `infra/egress-proxy/filter`, then rebuild the proxy (`docker compose up -d
  --build egress-proxy`) — otherwise the connection dies at the proxy.
- **Discord Premium Apps** (second billing rail): create the SKUs in the
  [dev portal](https://discord.com/developers/applications) (guild
  subscription SKUs for Pro/Studio at the same prices as Stripe, one
  consumable SKU for task packs) and set `DISCORD_SKU_PRO`,
  `DISCORD_SKU_STUDIO`, `DISCORD_SKU_PACK`. Payouts require a US/UK/EU
  developer entity. Unset = the rail stays inert; Stripe keeps working.

---

## Architecture

| Package | Role |
|---|---|
| `packages/shared` | NDJSON protocol between bot and runner (`TaskSpec` in, `RunnerEvent` out) |
| `apps/bot` | Discord, Supabase, GitHub App, container orchestration, HTTP server |
| `apps/runner` | Baked Docker image; clones repo, runs Claude Agent SDK, pushes branch |
| `infra/egress-proxy` | tinyproxy allowlist — Anthropic + GitHub only (production) |

**Security notes:**
- Tokens travel via container stdin, never env vars (`docker inspect` exposes env).
- Runner has dropped capabilities, memory/CPU/PID limits, AutoRemove.
- In production, runner containers can only reach `api.anthropic.com` + GitHub (egress proxy).
- Each guild's LLM credential is encrypted at rest (AES-256-GCM, per-guild key).
- GitHub install links are HMAC-signed + single-use DB nonces (unforgeable, unreplayable).
