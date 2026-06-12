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
  /** What produced this proposal; gates dismiss rules + card rendering. */
  source: text("source", {
    enum: ["chat", "issue", "schedule", "plan", "standup"],
  })
    .notNull()
    .default("chat"),
  /** source=issue: the GitHub issue number. */
  issueNumber: integer("issue_number"),
  /** source=schedule: the schedules row that fired. */
  scheduleId: text("schedule_id"),
  /** source=plan: the generated plan shown on the vote card. */
  planText: text("plan_text"),
  /** Discord message id of the card (reaction approval + in-place edits). */
  messageId: text("message_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Task-pack purchase ledger. Unique Stripe session id makes webhook
 * retries/replays idempotent; announcedAt drives the bot's public credit. */
export const taskPackPurchases = pgTable("task_pack_purchases", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  /** Discord user id of the buyer. */
  purchasedBy: text("purchased_by").notNull(),
  purchaserName: text("purchaser_name").notNull(),
  tasks: integer("tasks").notNull(),
  amountCents: integer("amount_cents").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id")
    .notNull()
    .unique(),
  announcedAt: timestamp("announced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One platform-key trial per GitHub org/user. Claimed at install-link time,
 * enforced when a platform-key task launches. */
export const githubOrgTrials = pgTable("github_org_trials", {
  /** Lowercased installation account login. */
  orgLogin: text("org_login").primaryKey(),
  guildId: text("guild_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Operator-flippable runtime flags (e.g. claude_oauth kill switch). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** GitHub webhook delivery dedup (X-GitHub-Delivery). Pruned at boot. */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Per-repo feature config (issue feed, auto-review). Guild-singleton config
 * lives as columns on guilds instead. */
export const repoSettings = pgTable(
  "repo_settings",
  {
    guildId: text("guild_id").notNull(),
    repoFullName: text("repo_full_name").notNull(),
    /** Issue-to-Proposal feed channel; null = off. */
    issueChannelId: text("issue_channel_id"),
    /** Label allowlist; empty = all labels. */
    issueLabels: jsonb("issue_labels").$type<string[]>().notNull().default([]),
    /** Minimum author_association for issue authors. */
    issueMinAssoc: text("issue_min_assoc", {
      enum: ["any", "contributor", "member", "owner"],
    })
      .notNull()
      .default("any"),
    issueDailyCap: integer("issue_daily_cap").notNull().default(10),
    issueCountToday: integer("issue_count_today").notNull().default(0),
    /** UTC day bucket the count belongs to. */
    issueCountDate: timestamp("issue_count_date", { withTimezone: true }),
    autoReview: boolean("auto_review").notNull().default(false),
    reviewChannelId: text("review_channel_id"),
    /** Consecutive Discord post failures; feed disables itself at 3. */
    failCount: integer("fail_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.repoFullName] })],
);

/** Recurring scheduled tasks ("the night shift"). Fire = proposal card. */
export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  prompt: text("prompt").notNull(),
  cadence: text("cadence", { enum: ["daily", "weekly"] }).notNull(),
  hourUtc: integer("hour_utc").notNull(),
  /** 0–6 (Sunday=0); weekly cadence only. */
  dayOfWeek: integer("day_of_week"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  failCount: integer("fail_count").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Server Memory: trusted per-repo conventions doc injected into every run. */
export const serverMemories = pgTable(
  "server_memories",
  {
    guildId: text("guild_id").notNull(),
    repoFullName: text("repo_full_name").notNull(),
    content: text("content").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.repoFullName] })],
);

/** Agent-proposed memory additions awaiting a save/dismiss click. */
export const memorySuggestions = pgTable("memory_suggestions", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  /** Newline-separated one-line rules. */
  rules: text("rules").notNull(),
  status: text("status", { enum: ["pending", "saved", "dismissed"] })
    .notNull()
    .default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Spectate Stage B event log (deferred feature; table ships now so the
 * protocol release doesn't need a second migration). */
export const taskEvents = pgTable("task_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  taskId: text("task_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
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
export type TaskPackPurchase = typeof taskPackPurchases.$inferSelect;
export type RepoSettings = typeof repoSettings.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type ServerMemory = typeof serverMemories.$inferSelect;
export type MemorySuggestion = typeof memorySuggestions.$inferSelect;
