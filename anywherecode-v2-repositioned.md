
# AnywhereCode v2 — Repositioned Idea (Full Document)

## One-liner

**The coding agent that belongs to your server, not to a person.** One shared AI engineer for your whole Discord community — OSS projects, game studios, indie teams. Anyone with the role ships code; humans stay the merge gate; the community watches it happen.

---

## 1. The Repositioning

### What changed in the market
"Coding agent in chat" is now table stakes. Claude Code is in Slack, Codex is in Slack, Devin is built around Slack, Copilot is in Teams. The category battle for *enterprise chat* is over — the giants won it.

But every one of those products shares one structural assumption: **the agent belongs to an individual with a per-seat license at a company.** Claude Code in Slack requires each user's personal linked Claude account. Copilot bills per seat. Devin bills per workspace at enterprise rates.

That assumption excludes the largest population of developers on Earth who *don't* work that way:

- **Open-source communities** — maintainers + drive-by contributors, no shared employer, no seat budget, already living on Discord
- **Indie game studios** — 2–8 people, mixed coders/artists/designers, Discord-native by culture
- **Hackathon & student teams** — zero budget, maximum velocity, Discord by default
- **Indie hacker / builder collectives** — small wallets, big output, public by nature

### The new position
AnywhereCode is not "Copilot Workspace in Discord." It is:

> **A server-level engineer.** One subscription per server. One shared LLM credential. Role-gated access. Every member with permission can ship; nobody needs their own seat, account, or license. The agent is community infrastructure — like the moderation bot, but it writes code.

This is the one position the incumbents *can't* chase without breaking their own per-seat business model. That's the moat.

### Why Discord specifically (now a feature, not a default)
1. **Public surface.** Slack is private; Discord is a stage. Every agent run in a public OSS server is a live demo to hundreds of onlookers. The product markets itself with every task.
2. **Voice.** Discord's defining primitive. No Slack-first competitor will prioritize voice-channel features. (See §4 — this becomes the headline disruptive feature.)
3. **Roles & community mechanics.** Discord's permission system, reactions, threads, and boost culture map perfectly onto multiplayer agent control and community-funded compute.
4. **Unserved.** As of mid-2026, no serious task→sandbox→PR coding agent is native to Discord. Notification bots and Q&A bots only.

---

## 2. Core Product (retained from v1, optimized)

### /code → pull request
Task in any channel → thread opens → agent works in an isolated container, streams progress live → pushes branch, opens PR with **Merge / Iterate / View / Preview** buttons. Merge without leaving Discord. Agent never touches main — branch + PR only. Humans stay the merge gate.

### /ask — repo-aware Q&A
Read-only questions grounded in the connected repo. 4× the code-task quota (cheap, never writes).

### Shared threads — multiplayer steering
Anyone replying in a task thread mid-run is forwarded to the live agent as a new instruction, prefixed with username. The team pair-programs with the agent together.

**v2 addition — Plan votes:** before burning a task, the agent posts its plan as a card. Team approves with ✅ reaction (configurable: instant / one approval / role-gated). Fits Discord reaction culture, prevents wasted quota, and creates a visible moment of team alignment. No competitor has a *social* approval step.

### @mention routing — ambient teammate
One classifier call routes a mention to: plain reply, /ask, /code, or a **proposal card** ("want me to do this?" with Run / Dismiss). Proposals are durable; any authorized member can fire them later.

### Iterate loop
PR not right? Click Iterate, give feedback, agent continues on the same branch. Conversation-to-merge never leaves Discord.

### Bring your own LLM
Each server connects its own credential — Anthropic API key or Claude Pro/Max subscription token, or any Anthropic-compatible endpoint. Encrypted at rest, scoped per server. API key recommended for commercial/production servers; subscription token supported for development use.

### Hardened by default
Ephemeral non-root containers, all capabilities dropped, CPU/mem/PID limits, auto-removed on exit, egress allowlisted (LLM provider + GitHub only). Short-lived repo-scoped GitHub tokens. Nothing persists except task history, memory files (see §3), and usage counters.

### Optimizations over v1
| v1 weakness | v2 fix |
|---|---|
| 1 concurrent task per server at every tier | Concurrency scales: 1 / 2 / 5 by tier |
| Free tier (5 tasks + mandatory BYO key) serves nobody | Replaced by **OSS Community tier** (see §5) |
| Claude Pro/Max subscription tokens as a connect option | **Kept as a connection option.** Servers connect either an Anthropic API key or a Claude Pro/Max subscription token. API key is the recommended path for commercial/production servers; the subscription-token path ships behind a feature flag with an instant kill-switch, so it can be disabled overnight without a redeploy if provider terms tighten |
| Trial runs arbitrary code on platform's key, wide open to farming | Trial gated: min server age (30d), min human members (5), one trial per GitHub org, owner verification, anomaly detection on egress & runtime |
| "Works from phone — hence the name" | Phone access is table stakes now (first-party mobile apps exist). De-emphasized in pitch; the name's "Anywhere" now means *anyone in the server, from anywhere* |

---

## 3. New Features (v2)

### Issue-to-Proposal pipeline ("the triage bridge")
GitHub webhook → new issue appears as a proposal card in a designated Discord channel → any authorized member clicks **Run** → PR.

Why it wins: AI issue triage is a crowded space *on the GitHub surface* (Dosu, GitHub Agentic Workflows, dozens of Actions). But all of it lives on GitHub, where the maintainers are — not where the *community* is. Nobody bridges GitHub events into a community space with one-click execution. AnywhereCode already has the proposal-card primitive; pointing webhooks at it turns the bot from reactive to a standing triage machine. Filters: label-based (only `good-first-issue`, only `bug`), author-trust thresholds, daily caps to prevent PR floods.

### Preview deployments on the PR card
Connect a Vercel / Netlify / Cloudflare Pages token once. Every PR card carries a **Preview** button → ephemeral deploy URL. Designers, mods, players — non-coders in the server — click and *see* the change before anyone merges.

Why it wins: this is the missing trust layer for merge-from-chat. "Merge from Discord" is a gimmick until non-engineers can verify the result. With previews, the entire review loop (task → code → see it live → merge) happens inside the server. No chat-based agent ships this today.

### Server Memory — persistent project context
A per-repo+server conventions file (style rules, architecture decisions, "we use pnpm never npm", "the ugly API stays public because of X"). Loaded into every run. Edited via `/memory` by authorized roles; agent proposes additions after corrections ("you've told me twice to avoid class components — save that?").

Why it wins: project memory is the known weak point of every drop-in agent — the *why* behind decisions lives nowhere. Memory makes output quality compound over time and creates real switching costs. Cheap to build, durable to keep.

### Review agent (/review + auto-mode)
Agent reviews *human* PRs: summary card in the channel, risk flags, suggested tests. Optional auto-mode reviews every PR on connected repos. Counts against the /ask quota (read-only). Makes the bot useful on days nobody delegates a task — daily-active glue.

### Scheduled tasks ("the night shift")
`/schedule` recurring jobs: nightly dependency bumps, flaky-test hunts, changelog generation, doc drift checks. Results arrive as proposal cards each morning — nothing merges without a human click. Continuous-AI patterns exist as GitHub Actions for people who write YAML; here it's one slash command, visible to the whole team.

### Ship Log — build-in-public engine
Optional channel where every merged agent PR auto-posts as a formatted ship announcement (what changed, who steered, preview link). Communities see momentum; builders get content; AnywhereCode gets ambient distribution. Zero competitors think about the *audience* of a coding agent. On Discord, there is one.

---

## 4. Disruptive Features (researched gaps — these don't exist yet)

### 🎙️ Voice → PR ("Standup Mode") — the headline
Opt-in: the bot joins a voice channel during standup/playtest. Live transcription → after the session (or live), it posts **proposal cards for action items it heard**: "Priya said the spawn bug crashes on respawn — want me to investigate? [Run / Dismiss]".

Gap check: meeting-AI tools (Tactiq, Otter-class) transcribe Zoom/Meet and extract action items into *documents and task trackers*. Voice-agent platforms (Vapi, Retell, LiveKit stacks) do real-time conversation. **Nobody connects live voice → coding agent → pull request, and nobody lives in Discord voice channels.** This is structurally impossible for Slack-first competitors to prioritize — Slack has no ambient voice culture. For game studios doing playtests in voice while playing, this is magic: bugs called out loud become PRs by end of session.

Ship as Studio-tier feature. Privacy-first: explicit `/standup start`, visible recording indicator, transcript auto-deleted after proposals are generated unless pinned.

### 🚀 Task Packs & Community-Funded Compute ("boosts for shipping")
Any server member — not just the admin — can buy a task pack ($10 / 50 tasks) *for the server*, Discord-boost style, with public credit ("@user powered 50 tasks this month 🔋").

Gap check: no coding agent on any platform has community-funded compute. It exists nowhere because no other agent lives somewhere with an audience. For OSS this is transformative: the community directly funds the project's AI engineer instead of vaguely donating. It converts AnywhereCode's revenue from "one admin's wallet" to "the whole server's wallet" — fundamentally better unit economics for the thin-wallet segment.

### 📺 Spectate Mode — agent runs as live entertainment
Long runs can be opened as a watchable live view (rich embed stream or Discord Activity): file tree, current diff, agent's running commentary. Members react, and authorized users interject (existing multiplayer steering).

Gap check: every competitor treats agent runs as private exhaust logs. On Discord, a coding run is *content* — educational for students, hype for communities, trust-building for maintainers ("watch exactly what it did before you merge"). Doubles as the most honest marketing in the category: the product demos itself in public, continuously.

### 🧩 Bounty Bridge (later-stage, OSS economy play)
Issues with attached bounties (Polar, Algora, GitHub Sponsors) surface as glowing proposal cards. Agent scaffolds the fix; a human contributor finishes, gets the bounty; maintainer merges. Positions the agent as a contributor-multiplier rather than a contributor-replacer — exactly the framing OSS culture will accept. Builds the first pipeline where community + agent co-earn.

### 🎮 Game-Dev Awareness (beachhead feature)
Shallow-but-real Godot/Unity/Unreal understanding: scene-file-aware diffs ("this changes the Player prefab's jump height"), GDScript/C# conventions in Server Memory templates, and playtest-build cards (CI artifact → downloadable build posted to a channel). Game developers are Discord's most native professional population and **no agent vendor serves them at all** — even mostly-positioning here wins the beachhead uncontested.

---

## 5. Pricing v2

Per-server (guild) subscription, Stripe-billed, monthly caps. /ask quota = 4× code-task cap on every tier. BYO credential after trial — Anthropic API key or Claude Pro/Max subscription token, encrypted at rest, scoped per server. Platform never pays inference; the subscription buys orchestration (sandboxing, GitHub integration, Discord UX, previews, memory, voice).

| Tier | Price | Code tasks/mo | Concurrency | Notes |
|---|---|---|---|---|
| **Trial** | free, 14 days | 10 | 1 | Platform's key (only tier). Abuse-gated: server age ≥30d, ≥5 human members, 1 trial per GitHub org |
| **OSS Community** | $0 | 30 pooled | 1 | Verified public open-source servers only. Maintainer-gated runs, unlimited /ask on public repos. The growth engine — every run is public marketing |
| **Pro** | $20/mo | 100 | 2 | BYO key, priority queue, Server Memory, Review agent, scheduled tasks |
| **Studio** | $50/mo | 500 | 5 | Everything + Voice/Standup Mode, Spectate, preview deploys, game-dev features |
| **Task Packs** | $10 / 50 tasks | add-on | — | Purchasable by **any member** for the server. Public credit. Never expires while subscribed |

Why this beats per-seat math: a 5-person team on Copilot Business ≈ $95/mo; on individual Claude/Codex plans ≈ $100/mo+. AnywhereCode Studio = $50/server + one shared key, and the *whole community* can contribute compute. The price comparison is the pitch.

---

## 6. Moat Logic (why incumbents won't just copy this)

1. **Business-model conflict.** Server-level shared access cannibalizes per-seat revenue. Anthropic/OpenAI/GitHub monetize individuals and enterprise seats; a $20/server shared agent is a product their finance teams will resist.
2. **Surface conflict.** Their integrations are enterprise plays (Slack/Teams). Discord communities, OSS servers, and game studios are off-strategy for them — small contract values, messy public spaces.
3. **Voice + spectate + community funding** are Discord-culture features. Porting a Slack bot via an adapter SDK gets you slash commands; it doesn't get you the culture layer. The defensible product is the culture layer.
4. **Server Memory + Ship Log history** create per-server switching costs that grow with usage.

Honest caveat: none of these stops a determined giant forever. The strategy is to own the community segment so thoroughly that by the time anyone cares, AnywhereCode *is* the default coding agent of Discord — the Mee6/Dyno of shipping code.

---

## 7. Go-to-Market

1. **Build in public via @thedslabs.** The development of AnywhereCode is itself reel content: "I'm building an AI engineer that lives in Discord." Each disruptive feature (voice→PR especially) is a standalone viral demo.
2. **Seed 10 visible OSS servers** on the free Community tier. Hand-hold setup personally. Their public task threads are the marketing.
3. **Hackathon circuit.** Free Studio tier for hackathon servers (MLH, regional Indian hackathons). Thousands of students watch the bot ship code all weekend; they bring it to their next team.
4. **Discord App Directory** listing + game-dev community outreach (Godot/indie servers are massive and tool-hungry).
5. **Ship Log virality.** Every public ship-log post carries a subtle "shipped with AnywhereCode" footer. The growth loop is the product working in public.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Anthropic/OpenAI ships a Discord integration | Move fast on the culture layer (voice, spectate, community funding, OSS mode) — the parts per-seat vendors won't build. Own the segment before they arrive |
| Thin wallets in the Discord segment | Per-server pricing + task packs spread cost across the community; OSS tier converts to Pro when projects grow |
| LLM provider ToS around credentials | Subscription-token connect kept, but isolated: feature-flagged with instant kill-switch, token usage clearly disclosed to the connecting user, API key promoted as the recommended path for commercial servers. If provider terms tighten, flip the flag — affected servers get a migration prompt to API keys, product survives |
| Trial abuse / key farming | Gates in §2; egress + runtime anomaly detection; hard kill-switch per server |
| Agent PR slop flooding OSS repos | Maintainer-gated runs, daily caps, label filters, plan-vote step — queue discipline is a feature, marketed as such |
| Discord platform risk (API/policy changes) | Architecture stays chat-agnostic internally (adapter pattern); Telegram/WhatsApp as expansion surfaces — note WhatsApp opens the India dev-team market later |

---

## 9. Roadmap (MVP-first)

**Phase 1 — Prove the core loop (weeks 1–8)**
/code → PR with Merge/Iterate/View, /ask, shared-thread steering, hardened sandbox, GitHub connect, Stripe billing, trial gates. Nothing else. Get 10 servers using it weekly.

**Phase 2 — Become a teammate (weeks 9–16)**
@mention routing + proposal cards, Issue-to-Proposal pipeline, Server Memory, plan votes, Review agent, Ship Log. This is where retention forms.

**Phase 3 — Become unmatchable (months 5–8)**
Voice/Standup Mode, preview deployments, Spectate Mode, scheduled tasks, task packs, OSS Community tier launch at scale, game-dev awareness.

**Phase 4 — Expand the surface (months 9+)**
Bounty bridge, Telegram/WhatsApp adapters, multi-repo orgs, team analytics dashboard.

---

## 10. The pitch, compressed

> Every coding agent today belongs to one developer with one license. AnywhereCode belongs to the server. It's the AI engineer your whole community shares — it listens in standup, turns issues into one-click PRs, shows everyone a live preview before merge, and lets the community itself fund the compute. Slack got the enterprise agents. Discord gets the people's one.
