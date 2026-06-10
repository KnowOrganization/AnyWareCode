import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(), // Discord guild snowflake
  githubInstallationId: bigint("github_installation_id", { mode: "number" }),
  /** Role allowed to invoke /code; null = server admins only. */
  allowedRoleId: text("allowed_role_id"),
  taskCap: integer("task_cap").notNull().default(50),
  tasksUsedThisMonth: integer("tasks_used_this_month").notNull().default(0),
  asksUsedThisMonth: integer("asks_used_this_month").notNull().default(0),
  capResetAt: timestamp("cap_reset_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type Guild = typeof guilds.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type SetupState = typeof setupStates.$inferSelect;
