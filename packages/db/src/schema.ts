import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Subscription tiers. Seeded rows; stripePriceId links a tier to Stripe. */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(), // "oss" | "pro" | "studio" | ...
  name: text("name").notNull(),
  /** Monthly /code cap (/ask cap = this × ASK_CAP_MULTIPLIER). */
  taskCap: integer("task_cap").notNull(),
  /** Concurrent tasks per guild; mirrored onto guilds.concurrency. */
  concurrency: integer("concurrency").notNull().default(1),
  stripePriceId: text("stripe_price_id"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  isDefault: boolean("is_default").notNull().default(false),
});

export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "free",
]);

export const ossStatus = pgEnum("oss_status", [
  "none",
  "pending",
  "approved",
  "rejected",
]);

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(), // Discord guild snowflake
  githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  /** Installation owner login (org or user), set at /github/setup. Keyed for
   * one-trial-per-org enforcement. */
  githubAccountLogin: text("github_account_login"),
  /** Role allowed to invoke /code; null = server admins only. */
  allowedRoleId: text("allowed_role_id"),
  /** Effective monthly /code cap. Maintained by ensureGuild (trial/free) and
   * the Stripe webhook (paid plan). capState reads this directly. */
  taskCap: integer("task_cap").notNull().default(0),
  /** Effective concurrent-task limit; mirror of plans.concurrency, same
   * maintenance pattern as taskCap. */
  concurrency: integer("concurrency").notNull().default(1),
  /** Task-pack balance. Never touched by the monthly reset. */
  packTasksRemaining: integer("pack_tasks_remaining").notNull().default(0),
  tasksUsedThisMonth: integer("tasks_used_this_month").notNull().default(0),
  asksUsedThisMonth: integer("asks_used_this_month").notNull().default(0),
  capResetAt: timestamp("cap_reset_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Billing. planId references plans.id once on a paid tier. */
  planId: text("plan_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subStatus: subscriptionStatus("sub_status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /** OSS Community tier application state. */
  ossStatus: ossStatus("oss_status").notNull().default("none"),
  ossAppliedAt: timestamp("oss_applied_at", { withTimezone: true }),
  ossReviewedAt: timestamp("oss_reviewed_at", { withTimezone: true }),
  /** Per-server hard kill switch (abuse response). */
  suspended: boolean("suspended").notNull().default(false),
  /** Trial abuse gates (server age + member count) passed; cached forever. */
  trialGatesPassedAt: timestamp("trial_gates_passed_at", { withTimezone: true }),
  /** Ship Log channel; null = off. */
  shiplogChannelId: text("shiplog_channel_id"),
  /** Plan-vote approval mode for code tasks. */
  planVoteMode: text("plan_vote_mode", {
    enum: ["instant", "one_approval", "role_gated"],
  })
    .notNull()
    .default("instant"),
  /** Role that may approve plan votes (role_gated mode). */
  planVoteRoleId: text("plan_vote_role_id"),
  /** BYO-LLM: guild-scoped credential. All nullable; absent = fall back to platform key. */
  llmProviderType: text("llm_provider_type", {
    enum: ["claude_oauth", "anthropic_api_key", "custom"],
  }),
  /** AES-256-GCM encrypted token blob (v1.<iv>.<ct>.<tag> base64url). */
  llmCredentialEnc: text("llm_credential_enc"),
  /** Custom provider only: Anthropic-compatible base URL. */
  llmBaseUrl: text("llm_base_url"),
  /** Custom provider only: model name passed as ANTHROPIC_MODEL. */
  llmModel: text("llm_model"),
  llmCredentialSetAt: timestamp("llm_credential_set_at", { withTimezone: true }),
});

export const channelRepos = pgTable("channel_repos", {
  channelId: text("channel_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
});

/**
 * Pending GitHub-App install links. A row is created when an admin starts the
 * install flow and consumed (deleted) on the callback, so a captured install
 * URL can't be replayed to relink a guild. Rows expire after a short window.
 */
export const setupStates = pgTable("setup_states", {
  nonce: text("nonce").primaryKey(),
  guildId: text("guild_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const taskStatus = pgEnum("task_status", [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  threadId: text("thread_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  branch: text("branch").notNull(),
  baseBranch: text("base_branch").notNull(),
  mode: text("mode", { enum: ["code", "ask"] }).notNull().default("code"),
  status: taskStatus("status").notNull().default("queued"),
  prNumber: integer("pr_number"),
  containerId: text("container_id"),
  prompt: text("prompt").notNull(),
  requestedBy: text("requested_by").notNull(),
  /** Quota bucket this task consumed; refunds must reverse the same bucket. */
  fundedBy: text("funded_by", { enum: ["plan", "pack"] })
    .notNull()
    .default("plan"),
  /** Discord message id of the PR card (Preview button edits it in place). */
  prMessageId: text("pr_message_id"),
  previewUrl: text("preview_url"),
  /** Atomic claim for the Ship Log dual-trigger (button + webhook). */
  shiplogPostedAt: timestamp("shiplog_posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * Tasks the bot inferred from conversation and proposed with a Run button.
 * Durable so Run buttons survive bot restarts; rows are claimed atomically
 * (pending -> accepted) and expire after CHAT_PROPOSAL_TTL_MINUTES.
 */
export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  /** Repo-binding text channel (parent channel when proposed inside a thread). */
  channelId: text("channel_id").notNull(),
  /** Set when the proposal was made inside an existing thread. */
  threadId: text("thread_id"),
  repoFullName: text("repo_full_name").notNull(),
  prompt: text("prompt").notNull(),
  summary: text("summary").notNull(),
  /** Discord user whose mention produced the proposal. */
  authorId: text("author_id").notNull(),
  status: text("status", { enum: ["pending", "accepted", "dismissed"] })
    .notNull()
    .default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Guild = typeof guilds.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type SetupState = typeof setupStates.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type SubStatus = Guild["subStatus"];
