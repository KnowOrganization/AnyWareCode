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

export const GITHUB_URL = "https://github.com";

/** Beta: every plan shown as $0, CTAs route to the waitlist. Flip to false to
 * restore paid prices + Discord install across the whole site. */
export const BETA = true;
export const WAITLIST_HREF = "#waitlist";

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

export interface LeadEntry {
  /** Verb-led story beat. */
  verb: string;
  /** One-line summary always visible in the row. */
  line: string;
  /** Detail revealed on hover / focus (always visible on touch). */
  body: string;
}

/** Chapter 01 — four entries carry the story; the annexes carry the rest. */
export const leadEntries: LeadEntry[] = [
  {
    verb: "Ship",
    line: "/code → a reviewed pull request",
    body: "Type a task in any channel. A thread opens, an isolated container does the work, and a PR lands with Merge / Iterate buttons. Your default branch is never touched.",
  },
  {
    verb: "Answer",
    line: "/ask — repo-aware, read-only",
    body: "Questions grounded in the connected repo, answered in the channel. Unlimited on every plan, because it never writes a thing.",
  },
  {
    verb: "Steer",
    line: "the whole room pair-programs",
    body: "Any reply in the thread forwards straight into the live run as a new turn. @mention the bot anywhere and it routes itself — a reply, an /ask, a /code run, or a proposal with Run buttons.",
  },
  {
    verb: "Guard",
    line: "slop filtered before it costs a minute",
    body: "Repro Gate verifies inbound bug reports in the sandbox before a human reads them. Quarantine strips hidden instructions from issues. Every PR carries its provenance receipt.",
  },
];

export interface Annex {
  title: string;
  line: string;
}

/** The compact index under the lead entries. */
export const annexes: Annex[] = [
  {
    title: "BYO LLM",
    line: "Anthropic key, Claude Pro/Max token, or compatible endpoint — encrypted per server",
  },
  {
    title: "Squad Mode",
    line: "N parallel attempts in separate sandboxes, the server votes",
  },
  {
    title: "MCP extensions",
    line: "your Sentry, database, or tracker — role-gated per connection",
  },
  {
    title: "Provenance receipts",
    line: "sponsor, approver, steerers, evidence — on every PR",
  },
  {
    title: "Hardened runtime",
    line: "non-root containers, cap-drop ALL, allowlisted egress",
  },
  {
    title: "Server Memory",
    line: "conventions accumulate; /memory commit flows them into AGENTS.md",
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
    chip: "✓ PR #128 → anywarecode/a1f3 · container removed",
  },
];

export interface SecurityPoint {
  title: string;
  body: string;
}

export const securityPoints: SecurityPoint[] = [
  {
    title: "Repo content is untrusted",
    body: "Injection defense is in the system prompt — instructions embedded in repo files are ignored.",
  },
  {
    title: "Credentials never leak",
    body: "Tokens travel over stdin and are stripped from every error path before text reaches Discord.",
  },
  {
    title: "AES-256-GCM at rest",
    body: "Keys are encrypted per server; one guild's blob can't decrypt for another.",
  },
  {
    title: "Isolated execution",
    body: "Non-root, every Linux capability dropped, CPU/mem/PID caps, removed on exit.",
  },
  {
    title: "Never pushes to main",
    body: "All git lands on anywarecode/<taskId>. A human merges, or nothing does.",
  },
  {
    title: "You control access",
    body: "Admins only by default; grant exactly one role with /config role.",
  },
];

export interface Tier {
  id: "free" | "oss" | "pro" | "studio";
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

// Every plan ships every feature — the only meter is monthly /code count.
// /ask is unlimited on all of them. You bring your own AI; we never bill for it.
export const tiers: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/mo",
    tagline: "A real plan, not a demo. Connect your own AI and go.",
    features: [
      "15 code tasks / mo",
      "Unlimited /ask",
      "Every feature included",
      "Bring your own AI",
    ],
    cta: "Add to Discord",
    external: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19 / ₹1600",
    period: "/mo",
    tagline: "One shared engineer for the whole server — no per-seat math.",
    features: [
      "150 code tasks / mo · 2 concurrent",
      "Unlimited /ask",
      "Every feature included",
      "Job packs to top up anytime",
    ],
    cta: "Get Pro",
    external: true,
    featured: true,
  },
  {
    id: "studio",
    name: "Studio",
    price: "$49 / ₹4100",
    period: "/mo",
    tagline: "For studios living in voice channels and shipping daily.",
    features: [
      "600 code tasks / mo · 5 concurrent",
      "Unlimited /ask",
      "Every feature included",
      "Voice → PR, Squad, Spectate",
    ],
    cta: "Get Studio",
    external: true,
  },
  {
    id: "oss",
    name: "OSS Community",
    price: "$0",
    period: "/mo",
    tagline: "For verified public open-source servers. Your runs are the demo.",
    features: [
      "40 code tasks / mo",
      "Unlimited /ask",
      "Every feature included",
      "Apply with /oss apply",
    ],
    cta: "Add to Discord",
    external: true,
  },
];

/** Community-funded compute — shown under the tier grid. */
export const taskPack = {
  name: "Job Pack",
  price: "$8 / ₹700",
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
    a: "No. Each task clones into an ephemeral container that's removed when it exits. We keep only task history and usage counters — removing the bot deletes your server's data.",
  },
  {
    q: "Whose LLM key is used?",
    a: "Yours, always. We don't supply AI or bill for it. Every server connects its own credential — an Anthropic API key, a Claude Pro/Max token, or any compatible endpoint — encrypted per server. The Free plan is the trial: connect your key and go.",
  },
  {
    q: "Can it push to my main branch?",
    a: "Never. All git lands on anywarecode/<taskId> and arrives as a pull request. Nothing merges without a human.",
  },
  {
    q: "What about prompt injection from repos and issues?",
    a: "Everything external is untrusted: quarantine strips hidden instructions from inbound issues, verification runs hold read-only tokens, and the container is sealed. Designed after the Comment and Control disclosures, not before them.",
  },
  {
    q: "Who in my server can invoke it?",
    a: "Admins only by default. Grant exactly one role with /config role. @everyone and @here never trigger it.",
  },
  {
    q: "Isn't this just more AI slop for maintainers?",
    a: "The opposite, by construction: every run has a named human sponsor, every PR carries a provenance receipt, and Repro Gate filters bug reports before they cost a human minute.",
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
    title: "Get started",
    links: [{ label: "Add to Discord", href: INSTALL_URL }],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy", href: "/legal/privacy" },
    ],
  },
] as const;
