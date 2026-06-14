import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string, ssl = false) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Supabase/managed PG terminate TLS with their own chain; we require
    // encryption but don't pin a CA.
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  return drizzle(pool, { schema });
}

/** Drain the underlying pg pool (graceful shutdown). */
export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}

/** Erase all data for a guild. Used by the GuildDelete handler (bot leaves a
 * server) and the dashboard's "delete server data" control. Order is
 * child-rows-first; there are no FK constraints, so it's just tidy. */
export async function deleteGuildData(db: Db, guildId: string): Promise<void> {
  await db.delete(schema.tasks).where(eq(schema.tasks.guildId, guildId));
  await db.delete(schema.proposals).where(eq(schema.proposals.guildId, guildId));
  await db
    .delete(schema.channelRepos)
    .where(eq(schema.channelRepos.guildId, guildId));
  await db
    .delete(schema.setupStates)
    .where(eq(schema.setupStates.guildId, guildId));
  await db
    .delete(schema.taskPackPurchases)
    .where(eq(schema.taskPackPurchases.guildId, guildId));
  await db
    .delete(schema.repoSettings)
    .where(eq(schema.repoSettings.guildId, guildId));
  await db.delete(schema.schedules).where(eq(schema.schedules.guildId, guildId));
  await db
    .delete(schema.serverMemories)
    .where(eq(schema.serverMemories.guildId, guildId));
  await db
    .delete(schema.memorySuggestions)
    .where(eq(schema.memorySuggestions.guildId, guildId));
  await db
    .delete(schema.mcpServers)
    .where(eq(schema.mcpServers.guildId, guildId));
  await db.delete(schema.squads).where(eq(schema.squads.guildId, guildId));
  await db
    .delete(schema.guildInstallations)
    .where(eq(schema.guildInstallations.guildId, guildId));
  // user_links is user-keyed, not guild-keyed — it survives guild deletion.
  await db.delete(schema.guilds).where(eq(schema.guilds.id, guildId));
}

/** Look up the plan a Razorpay plan id maps to, in either currency (null if
 * unknown). */
export async function findPlanByRazorpayPlanId(db: Db, planId: string) {
  return (
    (await db.query.plans.findFirst({
      where: or(
        eq(schema.plans.razorpayPlanIdInr, planId),
        eq(schema.plans.razorpayPlanIdUsd, planId),
      ),
    })) ?? null
  );
}

export type SubSource = "razorpay" | "discord" | "admin" | null;

/** Apply a subscription change (Razorpay webhook OR Discord entitlements OR an
 * admin override — the single billing choke point) to a guild. The effective
 * cap is copied onto guilds.taskCap so the bot's capState needs no plan join in
 * the hot path.
 *
 * `opts.onlyIfSource` makes a write conditional on the guild's CURRENT
 * subSource: a webhook passes `["razorpay", null]` so it can never clobber an
 * "admin" override or the Discord rail. */
export async function applyGuildSubscription(
  db: Db,
  guildId: string,
  patch: {
    razorpayCustomerId?: string;
    razorpaySubscriptionId?: string | null;
    subStatus: "active" | "past_due" | "canceled" | "free";
    subSource?: SubSource;
    planId?: string | null;
    taskCap?: number;
    concurrency?: number;
    currentPeriodEnd?: Date | null;
  },
  opts?: { onlyIfSource?: SubSource[] },
): Promise<void> {
  if (opts?.onlyIfSource) {
    const current = await db.query.guilds.findFirst({
      where: eq(schema.guilds.id, guildId),
      columns: { subSource: true },
    });
    if (current && !opts.onlyIfSource.includes(current.subSource)) return;
  }
  await db
    .update(schema.guilds)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.guilds.id, guildId));
}

// --- GitHub installations (multi-org connect) ---

export async function listGuildInstallations(db: Db, guildId: string) {
  return db.query.guildInstallations.findMany({
    where: eq(schema.guildInstallations.guildId, guildId),
    orderBy: schema.guildInstallations.linkedAt,
  });
}

/** Append a linked installation; re-linking the same one is a no-op. */
export async function addGuildInstallation(
  db: Db,
  row: { guildId: string; installationId: number; accountLogin: string },
): Promise<void> {
  await db
    .insert(schema.guildInstallations)
    .values(row)
    .onConflictDoNothing();
}

export async function removeGuildInstallation(
  db: Db,
  guildId: string,
  installationId: number,
): Promise<boolean> {
  const deleted = await db
    .delete(schema.guildInstallations)
    .where(
      and(
        eq(schema.guildInstallations.guildId, guildId),
        eq(schema.guildInstallations.installationId, installationId),
      ),
    )
    .returning();
  // Bindings to that installation's repos are dead — drop them with it.
  await db
    .delete(schema.channelRepos)
    .where(
      and(
        eq(schema.channelRepos.guildId, guildId),
        eq(schema.channelRepos.installationId, installationId),
      ),
    );
  return deleted.length > 0;
}

/** All guilds linked to an installation (webhook fan-out). */
export async function guildIdsForInstallation(
  db: Db,
  installationId: number,
): Promise<string[]> {
  const rows = await db.query.guildInstallations.findMany({
    where: eq(schema.guildInstallations.installationId, installationId),
  });
  return rows.map((r) => r.guildId);
}

// --- Task packs ---

/**
 * Credit a task-pack purchase. Idempotent on the provider payment id: a webhook
 * retry/replay inserts nothing and credits nothing. Returns whether this call
 * actually credited the balance.
 */
export async function recordTaskPackPurchase(
  db: Db,
  row: {
    id: string;
    guildId: string;
    purchasedBy: string;
    purchaserName: string;
    tasks: number;
    amountCents: number;
    razorpayPaymentId: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.taskPackPurchases)
      .values(row)
      .onConflictDoNothing({
        target: schema.taskPackPurchases.razorpayPaymentId,
      })
      .returning({ id: schema.taskPackPurchases.id });
    if (inserted.length === 0) return false;
    await tx
      .update(schema.guilds)
      .set({
        packTasksRemaining: sql`${schema.guilds.packTasksRemaining} + ${row.tasks}`,
      })
      .where(eq(schema.guilds.id, row.guildId));
    return true;
  });
}

export async function listUnannouncedPackPurchases(db: Db) {
  return db.query.taskPackPurchases.findMany({
    where: isNull(schema.taskPackPurchases.announcedAt),
  });
}

export async function markPackPurchaseAnnounced(
  db: Db,
  id: string,
): Promise<void> {
  await db
    .update(schema.taskPackPurchases)
    .set({ announcedAt: new Date() })
    .where(eq(schema.taskPackPurchases.id, id));
}

// --- App settings (runtime flags) ---

export async function getSetting(db: Db, key: string): Promise<unknown> {
  const row = await db.query.appSettings.findFirst({
    where: eq(schema.appSettings.key, key),
  });
  return row?.value;
}

export async function setSetting(
  db: Db,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

// --- OSS Community tier admin ---

export async function listPendingOssApplications(db: Db) {
  return db.query.guilds.findMany({
    where: eq(schema.guilds.ossStatus, "pending"),
  });
}

/**
 * Apply an operator's OSS decision. Approval grants the oss plan row's
 * entitlements; rejection just records the status.
 */
export async function applyOssDecision(
  db: Db,
  guildId: string,
  approved: boolean,
  ossPlan: { id: string; taskCap: number; concurrency: number },
): Promise<void> {
  await db
    .update(schema.guilds)
    .set(
      approved
        ? {
            ossStatus: "approved",
            ossReviewedAt: new Date(),
            planId: ossPlan.id,
            taskCap: ossPlan.taskCap,
            concurrency: ossPlan.concurrency,
            subStatus: "free",
          }
        : { ossStatus: "rejected", ossReviewedAt: new Date() },
    )
    .where(eq(schema.guilds.id, guildId));
}

export async function getPlan(db: Db, id: string) {
  return (
    (await db.query.plans.findFirst({ where: eq(schema.plans.id, id) })) ?? null
  );
}

/** Find the guild a Razorpay customer belongs to. */
export async function findGuildByRazorpayCustomer(db: Db, customerId: string) {
  return (
    (await db.query.guilds.findFirst({
      where: eq(schema.guilds.razorpayCustomerId, customerId),
    })) ?? null
  );
}

// --- Dashboard read/write helpers (keep the web app free of drizzle operators
// so it resolves a single drizzle instance). ---

export async function getGuild(db: Db, id: string) {
  return (await db.query.guilds.findFirst({ where: eq(schema.guilds.id, id) })) ?? null;
}

export async function getGuildsByIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db.query.guilds.findMany({ where: inArray(schema.guilds.id, ids) });
}

export async function getChannelReposForGuild(db: Db, guildId: string) {
  return db.query.channelRepos.findMany({
    where: eq(schema.channelRepos.guildId, guildId),
  });
}

export async function listPlans(db: Db) {
  return db.query.plans.findMany();
}

export async function setGuildRazorpayCustomer(
  db: Db,
  guildId: string,
  customerId: string,
): Promise<void> {
  await db
    .update(schema.guilds)
    .set({ razorpayCustomerId: customerId, updatedAt: new Date() })
    .where(eq(schema.guilds.id, guildId));
}

// --- Admin panel helpers (operator surface). Drizzle operators stay in this
// package so the web app resolves a single drizzle instance. ---

/** Statuses the admin panel may set directly. */
export type AdminSubStatus = "active" | "past_due" | "canceled" | "free";

/**
 * Admin override of a guild's billing. Forces subSource="admin" whenever a
 * tier/status field is touched, so no webhook rail re-projects over it. All
 * fields optional; only provided ones are written. `resetUsage` zeros the
 * monthly counters and rolls capResetAt forward 30 days.
 */
export async function adminSetGuildBilling(
  db: Db,
  guildId: string,
  patch: {
    planId?: string | null;
    subStatus?: AdminSubStatus;
    taskCap?: number;
    concurrency?: number;
    currentPeriodEnd?: Date | null;
    suspended?: boolean;
    packTasksRemaining?: number;
    razorpaySubscriptionId?: string | null;
    resetUsage?: boolean;
  },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const billingTouched =
    patch.planId !== undefined ||
    patch.subStatus !== undefined ||
    patch.taskCap !== undefined ||
    patch.concurrency !== undefined ||
    patch.currentPeriodEnd !== undefined;
  if (patch.planId !== undefined) set.planId = patch.planId;
  if (patch.subStatus !== undefined) set.subStatus = patch.subStatus;
  if (patch.taskCap !== undefined) set.taskCap = patch.taskCap;
  if (patch.concurrency !== undefined) set.concurrency = patch.concurrency;
  if (patch.currentPeriodEnd !== undefined)
    set.currentPeriodEnd = patch.currentPeriodEnd;
  if (patch.suspended !== undefined) set.suspended = patch.suspended;
  if (patch.packTasksRemaining !== undefined)
    set.packTasksRemaining = Math.max(0, patch.packTasksRemaining);
  if (patch.razorpaySubscriptionId !== undefined)
    set.razorpaySubscriptionId = patch.razorpaySubscriptionId;
  if (billingTouched) set.subSource = "admin";
  if (patch.resetUsage) {
    set.tasksUsedThisMonth = 0;
    set.asksUsedThisMonth = 0;
    set.capResetAt = new Date(Date.now() + 30 * 86_400_000);
  }
  await db.update(schema.guilds).set(set).where(eq(schema.guilds.id, guildId));
}

/** Toggle the hard kill switch (bot blocks /code & /ask when suspended). */
export async function setGuildSuspended(
  db: Db,
  guildId: string,
  suspended: boolean,
): Promise<void> {
  await db
    .update(schema.guilds)
    .set({ suspended, updatedAt: new Date() })
    .where(eq(schema.guilds.id, guildId));
}

/** Add (positive) or remove (negative) pack tasks, clamped at 0. */
export async function adjustPackTasks(
  db: Db,
  guildId: string,
  delta: number,
): Promise<void> {
  await db
    .update(schema.guilds)
    .set({
      packTasksRemaining: sql`greatest(0, ${schema.guilds.packTasksRemaining} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(schema.guilds.id, guildId));
}

export interface GuildListFilter {
  limit: number;
  offset: number;
  status?: AdminSubStatus;
  planId?: string;
  suspended?: boolean;
}

/** Paginated guild list with optional filters + total count. */
export async function listGuildsPaged(
  db: Db,
  f: GuildListFilter,
): Promise<{ rows: schema.Guild[]; total: number }> {
  const clauses = [
    f.status ? eq(schema.guilds.subStatus, f.status) : undefined,
    f.planId ? eq(schema.guilds.planId, f.planId) : undefined,
    f.suspended !== undefined
      ? eq(schema.guilds.suspended, f.suspended)
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;
  const rows = await db.query.guilds.findMany({
    where,
    orderBy: desc(schema.guilds.createdAt),
    limit: f.limit,
    offset: f.offset,
  });
  const [c] = await db
    .select({ n: count() })
    .from(schema.guilds)
    .where(where ?? sql`true`);
  return { rows, total: c?.n ?? 0 };
}

/** Search guilds by id prefix or Razorpay ids (guild names aren't stored). */
export async function searchGuilds(
  db: Db,
  q: string,
  limit = 25,
): Promise<schema.Guild[]> {
  const like = `${q}%`;
  return db.query.guilds.findMany({
    where: or(
      ilike(schema.guilds.id, like),
      ilike(schema.guilds.razorpayCustomerId, like),
      ilike(schema.guilds.razorpaySubscriptionId, like),
    ),
    limit,
  });
}

/** Edit a plan/tier row. Returns the updated row (null if no such plan). */
export async function updatePlan(
  db: Db,
  planId: string,
  patch: {
    name?: string;
    taskCap?: number;
    concurrency?: number;
    features?: string[];
    razorpayPlanIdInr?: string | null;
    razorpayPlanIdUsd?: string | null;
  },
): Promise<schema.Plan | null> {
  const [row] = await db
    .update(schema.plans)
    .set(patch)
    .where(eq(schema.plans.id, planId))
    .returning();
  return row ?? null;
}

/** Guild counts grouped by tier (planId) + status — admin dashboard metrics. */
export async function countGuildsByTierAndStatus(db: Db) {
  return db
    .select({
      planId: schema.guilds.planId,
      subStatus: schema.guilds.subStatus,
      n: count(),
    })
    .from(schema.guilds)
    .groupBy(schema.guilds.planId, schema.guilds.subStatus);
}

/** Total pack revenue (cents) + purchase count. */
export async function packRevenueTotals(
  db: Db,
): Promise<{ totalCents: number; n: number }> {
  const [r] = await db
    .select({
      total: sum(schema.taskPackPurchases.amountCents),
      n: count(),
    })
    .from(schema.taskPackPurchases);
  return { totalCents: Number(r?.total ?? 0), n: r?.n ?? 0 };
}

export async function listPaymentsForGuild(db: Db, guildId: string) {
  return db.query.taskPackPurchases.findMany({
    where: eq(schema.taskPackPurchases.guildId, guildId),
    orderBy: desc(schema.taskPackPurchases.createdAt),
  });
}

export async function listPaymentsForUser(db: Db, discordUserId: string) {
  return db.query.taskPackPurchases.findMany({
    where: eq(schema.taskPackPurchases.purchasedBy, discordUserId),
    orderBy: desc(schema.taskPackPurchases.createdAt),
  });
}

export async function listPaymentsPaged(
  db: Db,
  limit: number,
  offset: number,
): Promise<{ rows: schema.TaskPackPurchase[]; total: number }> {
  const rows = await db.query.taskPackPurchases.findMany({
    orderBy: desc(schema.taskPackPurchases.createdAt),
    limit,
    offset,
  });
  const [c] = await db
    .select({ n: count() })
    .from(schema.taskPackPurchases);
  return { rows, total: c?.n ?? 0 };
}

// --- Admin audit log ---

export async function writeAudit(
  db: Db,
  entry: {
    actorDiscordId: string;
    action: string;
    targetType: string;
    targetId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.insert(schema.adminAuditLog).values({
    actorDiscordId: entry.actorDiscordId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

export async function listAudit(
  db: Db,
  f: { targetType?: string; targetId?: string; limit: number; offset: number },
): Promise<schema.AdminAuditLog[]> {
  const clauses = [
    f.targetType ? eq(schema.adminAuditLog.targetType, f.targetType) : undefined,
    f.targetId ? eq(schema.adminAuditLog.targetId, f.targetId) : undefined,
  ].filter(Boolean);
  return db.query.adminAuditLog.findMany({
    where: clauses.length > 0 ? and(...clauses) : undefined,
    orderBy: desc(schema.adminAuditLog.createdAt),
    limit: f.limit,
    offset: f.offset,
  });
}

/** Absolute path to the migrations folder, resolved from this package so the
 * bot's boot migrate doesn't hard-code a relative path to another workspace.
 * Built with path.join rather than `new URL('../drizzle', import.meta.url)` so
 * bundlers (webpack/Next) don't try to bundle the folder as a module. */
export const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

export * as schema from "./schema.js";
export type {
  Guild,
  Task,
  SetupState,
  Proposal,
  Plan,
  SubStatus,
  TaskPackPurchase,
  RepoSettings,
  Schedule,
  ServerMemory,
  MemorySuggestion,
  UserLink,
  GuildInstallation,
  McpServerRow,
  Squad,
  RazorpayWebhookEvent,
  AdminAuditLog,
} from "./schema.js";
