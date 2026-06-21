import { z } from "zod";

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1),
  /** PEM, with literal \n allowed for env-file friendliness. */
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((key) => key.replaceAll("\\n", "\n")),
  /** Slug from app registration; used to build the install URL. */
  GITHUB_APP_SLUG: z.string().min(1).default("anywarecode"),
  /** AES-256-GCM encryption key for stored guild credentials. Min 32 chars. */
  CREDENTIAL_SECRET: z.string().min(32),
  /** Comma-separated hostnames permitted for custom LLM base URLs; empty = allow all (dev). */
  CUSTOM_PROVIDER_ALLOWLIST: z.string().default(""),
  DATABASE_URL: z.string().min(1),
  /**
   * TLS to Postgres. Required for Supabase (and any managed PG); leave false
   * for a plain local docker-compose database. "true" enables SSL without
   * pinning a CA (rejectUnauthorized: false), which matches Supabase pooler.
   */
  DATABASE_SSL: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Public base URL GitHub redirects to after install (no trailing slash). */
  PUBLIC_URL: z.string().url(),
  /** Secret for signing the install `state` param linking guild<->installation. */
  STATE_SECRET: z.string().min(16),
  HTTP_PORT: z.coerce.number().int().default(3000),
  RUNNER_IMAGE: z.string().default("anywarecode-runner"),
  /** Docker network the runner joins; empty string = default bridge (dev). */
  RUNNER_NETWORK: z.string().default(""),
  /** http://host:port of the egress allowlist proxy, if RUNNER_NETWORK is set. */
  RUNNER_HTTPS_PROXY: z.string().default(""),
  /** Hard wall-clock limit per task. */
  TASK_TIMEOUT_MINUTES: z.coerce.number().int().default(30),
  /** Minutes a GitHub-App install link stays valid before it must be reissued. */
  INSTALL_STATE_TTL_MINUTES: z.coerce.number().int().default(10),
  /** Model for bot-side mention classification/replies (custom providers use their own). */
  CHAT_MODEL: z.string().default("claude-haiku-4-5"),
  /** Per-guild mention classifications per minute (abuse damping, in-memory). */
  CHAT_RATE_PER_MINUTE: z.coerce.number().int().default(8),
  /** Minutes a proposed task's Run button stays valid. */
  CHAT_PROPOSAL_TTL_MINUTES: z.coerce.number().int().default(60),
  /** Sentry error tracking; disabled when empty. */
  SENTRY_DSN: z.string().default(""),
  /** Deploy environment tag for logs/Sentry. */
  NODE_ENV: z.string().default("development"),
  /** Max task/question prompt length; guards token/cap abuse. */
  MAX_PROMPT_CHARS: z.coerce.number().int().default(8000),
  /** Monthly /code cap on the Free plan (the BYO-LLM default tier). */
  FREE_TASK_CAP: z.coerce.number().int().default(15),
  /** GitHub App webhook secret; unset = /github/webhook disabled. */
  GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** GitHub App OAuth client (user identity linking); unset = /link github off. */
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  /** Discord Premium Apps SKU ids; unset = the Discord billing rail is inert. */
  DISCORD_SKU_PRO: z.string().min(1).optional(),
  DISCORD_SKU_STUDIO: z.string().min(1).optional(),
  DISCORD_SKU_PACK: z.string().min(1).optional(),
  /** Hostnames admins may point /connect mcp at; empty = any (dev only). */
  MCP_HOST_ALLOWLIST: z.string().default(""),
  /** Max parallel attempts per /code squad run. */
  SQUAD_MAX: z.coerce.number().int().min(2).max(5).default(3),
  /** Hours a squad vote card stays shippable. */
  SQUAD_VOTE_TTL_HOURS: z.coerce.number().int().default(24),
  /** Hours an issue-feed proposal's Run button stays valid. */
  ISSUE_PROPOSAL_TTL_HOURS: z.coerce.number().int().default(72),
  /** Hours a scheduled-task proposal's Run button stays valid. */
  SCHEDULE_PROPOSAL_TTL_HOURS: z.coerce.number().int().default(24),
  /** Minutes a plan-vote card stays approvable. */
  PLAN_VOTE_TTL_MINUTES: z.coerce.number().int().default(120),
  /** Max schedules per guild on tiers with the scheduled_tasks feature. */
  SCHEDULE_MAX_PER_GUILD: z.coerce.number().int().default(5),
  /** Server Memory size cap (Discord modal max is 4000). */
  MEMORY_MAX_CHARS: z.coerce.number().int().default(4000),
  /** Whisper transcription for /standup; unset = standup disabled. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Auto-stop a standup session after this many minutes. */
  STANDUP_MAX_MINUTES: z.coerce.number().int().default(30),
  /** Force-flush a single utterance buffer after this many seconds. */
  STANDUP_MAX_UTTERANCE_SECONDS: z.coerce.number().int().default(60),
  /** Public web base URL for the Razorpay pay-redirects + admin panel. */
  WEB_URL: z.string().default(""),
  /** Shared secret bridging bot↔web for billing: signs the Job-Pack attribution
   * token and authenticates the bot's cancel call. Set the SAME value in the web
   * app. Unset/empty = pack buttons are unattributed + the cancel button is hidden. */
  BILLING_BRIDGE_SECRET: z
    .string()
    .min(16)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Which runner engine to use. "claude" = Claude Agent SDK (default). */
  RUNNER_ENGINE: z.enum(["claude", "claw"]).default("claude"),
  /** Model used when a task doesn't request one (BYO providers use their own). */
  DEFAULT_MODEL: z.string().default("claude-sonnet-4-6"),
  /** Default model for /code when no model is picked (deeper work → Opus).
   * /ask and chat keep DEFAULT_MODEL. Ignored for custom providers. */
  CODE_MODEL: z.string().default("claude-opus-4-8"),
  /** Selectable models for /code (csv); empty = no picker, DEFAULT_MODEL only. */
  MODEL_ALLOWLIST: z
    .string()
    .default("claude-opus-4-8,claude-sonnet-4-6,claude-haiku-4-5"),
  /** Hard cap on agent turns per task (runaway guard). */
  MAX_AGENT_TURNS: z.coerce.number().int().default(60),
  /** Master switch for the verification + self-repair loop. */
  VERIFY_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  /** Repair attempts after a failed check (all tiers; 0 disables repair). */
  VERIFY_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  /** Share of remaining wall-clock reserved for verify+repair (0..1). */
  VERIFY_RESERVE_FRACTION: z.coerce.number().min(0).max(0.9).default(0.30),
  /** Stronger model used for repair turns (escalation); empty = no escalation. */
  VERIFY_REPAIR_MODEL: z.string().default("claude-opus-4-8"),
  /** Escalate to VERIFY_REPAIR_MODEL only after this many failed repairs (0 = first repair). */
  VERIFY_ESCALATE_AFTER: z.coerce.number().int().min(0).max(5).default(0),
  /** Per-user cooldown between task-launching commands, in seconds (abuse damping). */
  COMMAND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(5),
});

/** Parsed config plus derived convenience fields. */
export type Config = z.infer<typeof configSchema> & {
  /** MODEL_ALLOWLIST parsed once into a trimmed, non-empty list. */
  modelAllowlist: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Invalid configuration: ${missing}`);
  }
  // RUNNER_NETWORK and RUNNER_HTTPS_PROXY must be set together. A proxy without
  // the egress network leaves the runner on the default bridge, where the proxy
  // hostname can't resolve and every git clone / LLM call fails to connect.
  const { RUNNER_NETWORK, RUNNER_HTTPS_PROXY } = result.data;
  if (Boolean(RUNNER_NETWORK) !== Boolean(RUNNER_HTTPS_PROXY)) {
    throw new Error(
      "Invalid configuration: RUNNER_NETWORK and RUNNER_HTTPS_PROXY must both be set (prod) or both empty (dev).",
    );
  }
  const modelAllowlist = result.data.MODEL_ALLOWLIST.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { ...result.data, modelAllowlist };
}
