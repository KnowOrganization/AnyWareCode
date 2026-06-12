/**
 * Single source of truth for landing-page content + outbound links.
 * Sections import from here so copy/links stay consistent.
 *
 * NEXT_PUBLIC_* vars are inlined at build, so this module is safe to import
 * from client components.
 */

export const INSTALL_URL =
  process.env.NEXT_PUBLIC_DISCORD_INSTALL_URL ??
  "https://discord.com/oauth2/authorize";

/** Dashboard route. Sign-in is prompted there (Discord OAuth). */
export const DASHBOARD_URL = "/dashboard";

export const GITHUB_URL = "https://github.com";

export const nav = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Security", href: "#security" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
] as const;

/** Commands shown in the hero terminal demo + command marquee. */
export const commands = [
  { cmd: "/code", desc: "Spawn a thread, work the task, open a PR" },
  { cmd: "/ask", desc: "Repo-aware Q&A, read-only" },
  { cmd: "/connect github", desc: "Link your GitHub repos" },
  { cmd: "/connect llm", desc: "Bring your own LLM key" },
  { cmd: "/setup", desc: "Connection status + usage" },
  { cmd: "/repo set", desc: "Pick the active repo for a channel" },
  { cmd: "/status", desc: "Running and queued tasks" },
  { cmd: "/config role", desc: "Choose who may invoke the agent" },
] as const;

export interface Feature {
  /** Lucide-free: a short emoji/glyph used as the icon. */
  icon: string;
  title: string;
  body: string;
  accent: "indigo" | "violet" | "cyan" | "pink" | "mint" | "blurple";
}

export const features: Feature[] = [
  {
    icon: "⌗",
    title: "/code → pull request",
    body: "Type a task in any channel. The agent opens a thread, works in an isolated container, pushes a branch, and opens a PR with Merge / Iterate buttons.",
    accent: "indigo",
  },
  {
    icon: "?",
    title: "/ask, repo-aware",
    body: "Read-only Q&A grounded in the connected repo. Looser monthly cap than /code because it never writes.",
    accent: "cyan",
  },
  {
    icon: "⇄",
    title: "Shared threads",
    body: "Anyone in the thread can steer mid-task. Replies forward straight into the live agent as new turns — pair-program as a team.",
    accent: "violet",
  },
  {
    icon: "@",
    title: "@mention routing",
    body: "Tag the bot anywhere. One classifier call routes to a plain reply, an /ask, a /code run, or a durable proposal with Run / Dismiss buttons.",
    accent: "pink",
  },
  {
    icon: "⚷",
    title: "Bring your own LLM",
    body: "Each server connects its own credential — Anthropic API key, a Claude Pro/Max subscription token, or any Anthropic-compatible endpoint. Encrypted at rest.",
    accent: "mint",
  },
  {
    icon: "▣",
    title: "Hardened by default",
    body: "Ephemeral non-root containers, read-only tokens for verification runs, and a quarantine layer that strips hidden instructions from inbound issues — designed after Comment and Control, not before it.",
    accent: "blurple",
  },
  {
    icon: "🔬",
    title: "Repro Gate",
    body: "Inbound bug reports get verified in the sandbox before a human spends a minute: symbols checked, snippets run, a verdict card posted. Your slop filter, not another slop source.",
    accent: "mint",
  },
  {
    icon: "🧾",
    title: "Provenance receipts",
    body: "Every agent PR names its human sponsor, plan approver, and steerers — with test evidence and a link to the public thread. The only AI contribution maintainers can audit.",
    accent: "indigo",
  },
  {
    icon: "⚔",
    title: "Squad Mode",
    body: "Hard problem? Run N parallel attempts in separate sandboxes, compare diffs side by side, and let the server vote on which one ships.",
    accent: "pink",
  },
  {
    icon: "🔌",
    title: "MCP extensions",
    body: "Attach your Sentry, database, or tracker via Model Context Protocol — the agent runs with your context, role-gated and egress-allowlisted per connection.",
    accent: "cyan",
  },
];

export interface Step {
  n: string;
  title: string;
  body: string;
  code?: string;
}

export const steps: Step[] = [
  {
    n: "01",
    title: "Add to Discord",
    body: "Invite the bot with one click. It registers its slash commands automatically on boot.",
    code: "Add to Discord →",
  },
  {
    n: "02",
    title: "Connect repo + key",
    body: "Link a GitHub repo and bring your own LLM credential. Both are scoped per server.",
    code: "/connect github\n/connect llm",
  },
  {
    n: "03",
    title: "Type /code",
    body: "Describe the change in any channel. A thread opens and the agent streams its progress live.",
    code: "/code add dark-mode toggle to settings",
  },
  {
    n: "04",
    title: "Review the PR",
    body: "It pushes a branch and opens a pull request. Merge, or hit Iterate to keep going — never touches main.",
    code: "✓ PR #128 opened",
  },
];

export interface PipelineStage {
  n: string;
  title: string;
  body: string;
  /** Mono telemetry chip shown under the stage copy. */
  chip: string;
}

/** Stages of the pinned 3D custody scene — one quarter of scroll each. */
export const pipeline: PipelineStage[] = [
  {
    n: "01",
    title: "Prompt",
    body: "Type /code in any channel. A thread opens and the task is signed to a named human sponsor — nothing runs anonymously.",
    chip: "/code fix the flaky retry test",
  },
  {
    n: "02",
    title: "Isolate",
    body: "An ephemeral container seals around the task — non-root, every Linux capability dropped, egress allow-listed to Anthropic and GitHub only.",
    chip: "container a1f3 · cap-drop ALL · egress 2 hosts",
  },
  {
    n: "03",
    title: "Work",
    body: "The agent reads the repo, edits, runs the tests. Every step streams to the thread, and anyone in it can steer mid-task.",
    chip: "14 files read · 6 edits · tests 42/42 ✓",
  },
  {
    n: "04",
    title: "Ship",
    body: "A branch is pushed, a pull request opens carrying its provenance receipt, and the container is destroyed. A human merges — or hits Iterate.",
    chip: "✓ PR #128 → anywherecode/a1f3 · container removed",
  },
];

export interface SecurityPoint {
  title: string;
  body: string;
}

export const securityPoints: SecurityPoint[] = [
  {
    title: "Repo content is untrusted",
    body: "The agent is told to ignore instructions embedded in repo files — a prompt-injection defense baked into its system prompt.",
  },
  {
    title: "Credentials never leak",
    body: "Tokens travel over stdin, never as container env vars, and are stripped from every error path before any text can reach Discord.",
  },
  {
    title: "AES-256-GCM at rest",
    body: "Stored LLM keys are encrypted with a per-server key derived via HKDF; a guild's blob can't be copied to another server.",
  },
  {
    title: "Isolated execution",
    body: "Containers drop all Linux capabilities, run non-root with CPU/mem/PID caps, auto-remove, and in prod can only reach Anthropic + GitHub.",
  },
  {
    title: "Never pushes to main",
    body: "Git happens in one place. The bot opens PRs on branch anywherecode/<taskId>; nothing ever pushes to your default branch.",
  },
  {
    title: "You control access",
    body: "Admins-only by default. Pick exactly which role may invoke the agent with /config role.",
  },
];

export interface Tier {
  id: "oss" | "pro" | "studio";
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  cta: string;
  /** External (Discord install) vs internal (dashboard checkout). */
  external: boolean;
  featured?: boolean;
}

export const tiers: Tier[] = [
  {
    id: "oss",
    name: "OSS Community",
    price: "$0",
    period: "/mo",
    tagline: "For verified public open-source servers. Your runs are the demo.",
    features: [
      "30 pooled code tasks / mo",
      "Unlimited questions on public repos",
      "Repro Gate — filter slop reports free",
      "Maintainer-gated runs",
      "Apply with /oss apply",
    ],
    cta: "Add to Discord",
    external: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$20",
    period: "/mo",
    tagline: "One shared engineer for the whole server — no per-seat math.",
    features: [
      "100 code tasks / mo",
      "400 questions / mo + Repro Gate",
      "2 concurrent tasks",
      "Server Memory + Review agent",
      "Scheduled tasks + MCP extensions",
    ],
    cta: "Get Pro",
    external: false,
    featured: true,
  },
  {
    id: "studio",
    name: "Studio",
    price: "$50",
    period: "/mo",
    tagline: "For studios living in voice channels and shipping daily.",
    features: [
      "500 code tasks / mo",
      "2,000 questions / mo",
      "5 concurrent tasks",
      "Voice → PR Standup Mode",
      "Squad Mode + Spectate + previews",
    ],
    cta: "Get Studio",
    external: false,
  },
];

/** Community-funded compute — shown under the tier grid. */
export const taskPack = {
  name: "Task Pack",
  price: "$10",
  blurb:
    "50 extra code tasks for the server, buyable by ANY member — Discord-boost style, with public credit. Never expires while subscribed.",
} as const;

export interface Faq {
  q: string;
  a: string;
}

export const faqs: Faq[] = [
  {
    q: "Do you store my code?",
    a: "No. Each task clones into an ephemeral container that is auto-removed when it exits. We persist only task history and usage counters — removing the bot deletes your server's data.",
  },
  {
    q: "Whose LLM key is used?",
    a: "Yours. Every server connects its own credential, encrypted per-server with AES-256-GCM. The 14-day trial runs on a small platform allowance; after that, bring your own. An Anthropic API key is the recommended path for production servers.",
  },
  {
    q: "What's a task pack?",
    a: "Community-funded compute: any member can buy 50 extra code tasks for the server ($10), Discord-boost style — with public credit in the server. Packs sit in reserve and are spent after the monthly plan cap.",
  },
  {
    q: "Why does the trial have requirements?",
    a: "The trial runs on our key, so it's gated against farming: the server must be at least 30 days old with 5+ human members, and each GitHub org gets one trial. Connecting your own key skips all gates.",
  },
  {
    q: "Which providers are supported?",
    a: "An Anthropic API key, a Claude Pro/Max subscription token (claude setup-token), or any Anthropic-compatible endpoint such as a LiteLLM proxy.",
  },
  {
    q: "Can it push to my main branch?",
    a: "Never. All git activity is confined to one place — it pushes to anywherecode/<taskId> and opens a pull request. Your default branch is never touched.",
  },
  {
    q: "Who in my server can invoke it?",
    a: "Admins only by default. Use /config role to grant a specific role access. @everyone and @here never trigger the bot.",
  },
  {
    q: "What about prompt injection from repos and issues?",
    a: "All external content is treated as untrusted. Inbound issues and PRs pass a quarantine layer that strips HTML comments and invisible Unicode and flags instruction-like content on the card; verification runs hold read-only tokens; and the container is fully isolated. Designed after the Comment and Control disclosures, not before them.",
  },
  {
    q: "Isn't this just more AI slop for maintainers?",
    a: "The opposite, by construction: nothing runs without a named human sponsor, every PR carries a provenance receipt (who asked, who approved, who steered, what was verified), and Repro Gate filters incoming bug reports before they cost a human minute.",
  },
  {
    q: "What's an AGENTS.md and why do you care?",
    a: "The open per-repo conventions standard read by 20+ coding tools. AnyWareCode reads yours on every run, and /memory commit flows your server's accumulated conventions back into it via PR — your context improves every agent you use, not just ours.",
  },
];

export const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how" },
      { label: "Security", href: "#security" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Dashboard", href: DASHBOARD_URL },
      { label: "Add to Discord", href: INSTALL_URL },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy", href: "/legal/privacy" },
    ],
  },
] as const;
