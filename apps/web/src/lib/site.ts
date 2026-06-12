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
    body: "Every task runs in an ephemeral, non-root container: all capabilities dropped, CPU/mem/PID limits, auto-removed, and egress locked to an allowlist in prod.",
    accent: "blurple",
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
  id: "free" | "pro" | "team";
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
    id: "free",
    name: "Free",
    price: "$0",
    period: "/mo",
    tagline: "Kick the tires. 14-day trial on us, then bring your own key.",
    features: [
      "5 code tasks / mo",
      "20 questions / mo",
      "14-day trial on the platform key",
      "Bring your own LLM after trial",
      "Community support",
    ],
    cta: "Add to Discord",
    external: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$20",
    period: "/mo",
    tagline: "For active teams shipping every day.",
    features: [
      "100 code tasks / mo",
      "400 questions / mo",
      "Bring your own LLM key",
      "Priority task queue",
      "Email support",
    ],
    cta: "Get Pro",
    external: false,
    featured: true,
  },
  {
    id: "team",
    name: "Team",
    price: "$50",
    period: "/mo",
    tagline: "Heavy throughput across many channels.",
    features: [
      "500 code tasks / mo",
      "2,000 questions / mo",
      "Bring your own LLM key",
      "Priority queue + support",
      "Multi-repo per channel",
    ],
    cta: "Get Team",
    external: false,
  },
];

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
    a: "Yours. Every server connects its own credential, encrypted per-server with AES-256-GCM. The 14-day trial runs on a small platform allowance; after that, bring your own.",
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
    q: "What about prompt injection from repos?",
    a: "Repo content is treated as untrusted. The agent's system prompt instructs it to ignore embedded instructions, and the container is fully isolated as a second line of defense.",
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
