# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AnyWareCode is a Discord bot that runs a shared coding agent against a server's
GitHub repos and opens PRs. A user types `/code <task>` in a channel; the bot
opens a thread, spins up an ephemeral Docker container that clones the repo and
runs the Claude Agent SDK, streams progress back to the thread, pushes a branch,
and opens a PR. See `README.md` for the product surface and operator setup.

## Commands

pnpm monorepo (Node >= 22, `packageManager: pnpm@10.33.0`). **Use pnpm, not npm** —
a stray `package-lock.json` / root `dependencies` block may be present but the
source of truth is `pnpm-lock.yaml` + `pnpm-workspace.yaml`. The runner Dockerfile
also assumes pnpm/corepack.

```sh
pnpm install
pnpm -r typecheck                          # strict TS across workspace
pnpm -r test                               # vitest in every package
pnpm dev                                   # bot only, tsx watch (does NOT rebuild the runner)
pnpm -r build                              # tsc to dist/ in each package

# single package / single test
pnpm --filter @anywarecode/bot test               # one package's suite
pnpm --filter @anywarecode/bot test gates         # files matching "gates" (vitest pattern)

# database (Drizzle + Postgres; schema + migrations live in packages/db)
pnpm --filter @anywarecode/db db:generate         # after editing packages/db/src/schema.ts
pnpm --filter @anywarecode/db db:migrate
pnpm --filter @anywarecode/db build               # rebuild after schema edits (dist-resolved, like @anywarecode/shared)

pnpm --filter @anywarecode/bot register-commands  # push slash commands to Discord (also runs on bot boot)
docker compose up -d                               # dev: postgres + egress proxy only
docker compose up -d --build                       # prod: builds + starts bot, runner image, postgres, egress proxy
docker build -f apps/runner/Dockerfile -t anywarecode-runner .   # runner only (built from REPO ROOT)
```

## Architecture

Five workspaces, **three processes**, one protocol:

- `packages/shared` — the contract. `src/index.ts` defines the NDJSON protocol
  between bot and runner: `TaskSpec` (host→runner, first stdin line), `HostMessage`
  (host→runner, thread replies + cancel), `RunnerEvent` (runner→stdout, one JSON
  line each). All zod-validated; non-JSON stdout lines are treated as runner debug
  and ignored. **This file is the seam between the two processes — changing it means
  rebuilding the runner image.**
- `packages/db` — the Drizzle schema, `createDb`, exported types, and the migrations
  (`drizzle/`). Shared so both `apps/bot` and the future `apps/web` use one schema.
  Dist-resolved like `packages/shared`: **rebuild it after editing `schema.ts`**.
  `migrationsDir` is exported so the bot's boot migrate finds the folder.
- `apps/bot` — the long-lived host. Owns Discord (discord.js), GitHub (octokit App),
  an HTTP server (fastify), and container lifecycles. Reads/writes Postgres via
  `@anywarecode/db`.
- `apps/runner` — the per-task payload, baked into the `anywarecode-runner` Docker
  image. Clones the repo, wraps the Claude Agent SDK, commits/pushes, exits.
- `apps/web` — the Next.js dashboard + marketing site (deploy: Vercel). Discord
  OAuth (Auth.js), reads `@anywarecode/db` directly, and owns the **only Razorpay
  write surface** (`/api/razorpay/webhook` → guild billing columns; dual-currency
  USD+INR by geo). The bot only *reads* those columns. Subscription checkout in
  `/api/checkout`, one-time job packs in `/api/checkout/pack`.

**Request flow** (`/code` → PR):
1. `discord/interactions.ts` validates perms/cap/repo, opens a thread, calls
   `orchestrator.run(...)`.
2. `orchestrator/taskRunner.ts` writes a `tasks` row, acquires the per-guild slot
   (`limiter.ts`), mints a short-lived repo-scoped GitHub token (`github/app.ts`),
   and calls `workspace.start(spec, env)`.
3. `orchestrator/workspace.ts` (`DockerWorkspace`) creates a hardened container,
   writes the `TaskSpec` to stdin, and exposes an `AsyncIterable<RunnerEvent>`.
4. `runner/index.ts` clones via `runner/git.ts`, runs `ClaudeAgent`
   (`runner/agent.ts`), maps SDK messages → `RunnerEvent`s, then commits + pushes
   branch `anywarecode/<taskId>`.
5. Back in the bot, `taskRunner` consumes events: `renderer.ts` maintains a rolling
   progress embed (throttled edits); on `pushed` it opens the PR and posts
   Merge / Iterate / View buttons (handled in `interactions.ts`).

**Two extension seams, both behind interfaces** — implement the interface, swap the
impl, touch nothing else:
- `Workspace` (`orchestrator/workspace.ts`) — execution backend. v1 = local Docker;
  Fly Machines / Firecracker later.
- `Agent` (`runner/agent.ts`) — the engine. v1 = Claude Agent SDK; other engines later.

**Shared threads**: any non-bot reply in a task thread is forwarded
(`index.ts` → `orchestrator.forwardThreadMessage` → container stdin → `AsyncQueue`
→ a new user turn in the live agent stream), prefixed with the Discord username.

**@mentions** (`discord/mentions.ts`): tagging the bot anywhere classifies the
recent conversation with one bot-side LLM call (`llm/chat.ts` — the ONLY place
the bot process calls an LLM; forced `decide` tool call, untrusted-history
system prompt) and routes: `reply` (plain message, no container, no cap),
`ask`/`code` (gated by `canInvoke`, runs the normal pipeline), or
`propose_code` (durable `proposals` row + Run/Dismiss buttons; Run re-gates the
clicker and claims the row atomically). Detection is content-token-based —
implicit reply pings, `@everyone`/`@here` never trigger. Mentions in an active
task thread are forwarded to the agent, never classified. All four task entry
points (slash, Iterate button, mention, proposal Run) funnel through
`discord/launch.ts` (`checkTaskPreconditions` + `launchTask`) — keep new entry
points on that path. Chat replies must keep `allowedMentions: { parse: [] }`
(model output derived from untrusted history must never ping).

## Invariants & gotchas

- **The runner is a baked image, not live code.** `pnpm dev` reloads only the bot.
  After any change to `apps/runner` or `packages/shared`, rebuild the runner image,
  or tasks run stale code. `docker compose up -d --build` rebuilds both atomically.
- **Git happens only in `runner/git.ts`.** The agent is prompted (and `allowedTools`
  is scoped) to never run `git push/checkout/config`. The bot opens PRs; nothing
  ever pushes to the default branch. Branch namespace: `anywarecode/<taskId>`.
- **Credential hygiene.** LLM tokens and installation tokens travel via stdin (TaskSpec),
  never as container env vars (visible in `docker inspect`). The runner calls
  `registerSecret()` for each token so `redactSecrets()` strips them from every error
  path before text can reach Discord. Preserve this on any new error path.
- **Runner sets exactly ONE credential env set.** It explicitly deletes all credential
  env vars (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`) then sets only the one matching
  `spec.llmAuth.type`. Setting both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`
  causes the SDK to reject the request.
- **BYO-LLM only — there is no platform key.** `resolveLlmAuth` returns the guild's
  encrypted credential or blocks with a "run `/connect llm`" message; there is no
  platform `ANTHROPIC_API_KEY` fallback and no free trial. Undecryptable guild
  credential → explicit "reconnect" error. `CREDENTIAL_SECRET` rotation bricks stored
  creds; rotation requires all guilds to `/connect llm` again.
- **Credentials at rest are AES-256-GCM** (`llm/credentials.ts`). Key derived via
  HKDF-SHA256 from `CREDENTIAL_SECRET`. AAD = guildId prevents cross-guild blob copy.
  Blob format: `v1.<iv>.<ct>.<tag>` (all base64url). The HKDF salt string
  (`"anywherecode"`) is frozen — it is NOT a rename target; changing it would make
  every stored blob undecryptable.
- **Billing/plans (per-guild). One meter, flat features.** Every plan ships EVERY
  feature; plans differ only by the monthly `/code` cap (Free 15, OSS 40, Pro 150,
  Studio 600) and concurrency (1/1/2/5). `/ask` is **unlimited on every plan**. All
  four plan rows carry the same machine feature flags, so `planHasFeature` is true
  for any entitled guild. **Free is the universal floor**: `resolveTier` returns
  `paid` (active/past_due + paid plan), `oss` (approved), else `free` — a canceled
  paid plan falls back to Free, never to nothing. The effective cap lives on
  `guilds.taskCap`, read by `capState`. `ensureGuild` creates new guilds directly on
  Free (`subStatus:"free"`, `planId:"free"`, cap=`FREE_TASK_CAP`) and normalizes any
  non-paid/non-OSS guild back onto the Free floor; the Razorpay/Discord webhooks set
  it for paid tiers and drop to the Free floor on cancel. `/billing` shows tier + usage.
- **Boot sequence:** migrations (`drizzle-orm/node-postgres/migrator`) → command
  registration (global PUT, idempotent) → recovery sweep (stale tasks → failed + refund
  + thread notify) → orphan container kill → `client.login`.
- **Repo content is untrusted.** `HARDENING_PROMPT` in `agent.ts` tells the agent to
  ignore instructions embedded in repo files (prompt-injection defense). The agent
  runs with `permissionMode: "bypassPermissions"` — safe *only* because the container
  is isolated (CapDrop ALL, mem/cpu/pid limits, AutoRemove, non-root, and in prod a
  network whose only exit is the `infra/egress-proxy` allowlist: Anthropic + GitHub).
  Dev leaves `RUNNER_NETWORK` empty (default bridge); prod sets it plus
  `RUNNER_HTTPS_PROXY`.
- **Install → guild linking is HMAC-signed state only** (`github/state.ts`). GitHub's
  setup redirect hits `/github/setup` (`http/server.ts`); reject any unverifiable
  `state`. There are no GitHub webhooks in v1.
- **Concurrency is in-process and not durable.** `GuildTaskLimiter` (one task/guild)
  and the active-task map live in memory — a bot restart loses queued/running state.
  Monthly usage caps *are* persisted (`guilds` table, rolled in `gates.ts:ensureGuild`).
- **Config is fail-fast.** `config.ts` zod-parses env at boot and throws listing
  missing keys. Add new env vars there; mirror in `.env.example`.
- TypeScript is strict with `noUncheckedIndexedAccess` and NodeNext ESM — imports use
  `.js` extensions, array/index access is `T | undefined`.
