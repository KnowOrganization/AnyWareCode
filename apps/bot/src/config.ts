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
  GITHUB_APP_SLUG: z.string().min(1).default("anywherecode"),
  /** Platform fallback key; optional when guilds supply their own via /connect llm. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
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
  RUNNER_IMAGE: z.string().default("anywherecode-runner"),
  /** Docker network the runner joins; empty string = default bridge (dev). */
  RUNNER_NETWORK: z.string().default(""),
  /** http://host:port of the egress allowlist proxy, if RUNNER_NETWORK is set. */
  RUNNER_HTTPS_PROXY: z.string().default(""),
  /** Hard wall-clock limit per task. */
  TASK_TIMEOUT_MINUTES: z.coerce.number().int().default(30),
  /** Tighter wall-clock limit for platform-key (trial) tasks. */
  TRIAL_TASK_TIMEOUT_MINUTES: z.coerce.number().int().default(15),
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
  /** Free trial length (days). Trial runs on the platform key. */
  TRIAL_DAYS: z.coerce.number().int().default(14),
  /** Monthly /code cap during the trial (bounds platform-key token cost). */
  PLATFORM_TRIAL_TASK_CAP: z.coerce.number().int().default(10),
  /** Trial abuse gate: minimum Discord server age (snowflake-derived). */
  TRIAL_MIN_SERVER_AGE_DAYS: z.coerce.number().int().default(30),
  /** Trial abuse gate: minimum non-bot members. */
  TRIAL_MIN_HUMAN_MEMBERS: z.coerce.number().int().default(5),
  /** GitHub App webhook secret; unset = /github/webhook disabled. */
  GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
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
  /** Public dashboard URL for upgrade/billing links. */
  WEB_URL: z.string().default(""),
});

export type Config = z.infer<typeof configSchema>;

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
  return result.data;
}
