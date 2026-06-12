import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  // github_org_trials intentionally survives guild deletion: the org's trial
  // is consumed forever (re-adding the bot must not grant a fresh trial).
  // user_links is user-keyed, not guild-keyed — it survives too.
  await db.delete(schema.guilds).where(eq(schema.guilds.id, guildId));
}

/** Look up the plan a Stripe price id maps to (null if unknown). */
export async function findPlanByStripePrice(db: Db, priceId: string) {
  return (
    (await db.query.plans.findFirst({
      where: eq(schema.plans.stripePriceId, priceId),
    })) ?? null
  );
}

/** Apply a subscription change (Stripe webhook OR Discord entitlements — the
 * single billing choke point) to a guild. The effective cap is copied onto
 * guilds.taskCap so the bot's capState needs no plan join in the hot path. */
export async function applyGuildSubscription(
  db: Db,
  guildId: string,
  patch: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string | null;
    subStatus: "active" | "past_due" | "canceled" | "free";
    subSource?: "stripe" | "discord" | null;
    planId?: string | null;
    taskCap?: number;
    concurrency?: number;
    currentPeriodEnd?: Date | null;
  },
): Promise<void> {
  await db
    .update(schema.guilds)
    .set(patch)
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
 * Credit a task-pack purchase. Idempotent on the Stripe checkout session id:
 * a webhook retry/replay inserts nothing and credits nothing. Returns whether
 * this call actually credited the balance.
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
    stripeCheckoutSessionId: string;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.taskPackPurchases)
      .values(row)
      .onConflictDoNothing({
        target: schema.taskPackPurchases.stripeCheckoutSessionId,
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

// --- GitHub org trials ---

/**
 * Claim the platform-key trial for a GitHub org/user login. First guild wins;
 * returns the owning row either way.
 */
export async function claimOrgTrial(db: Db, orgLogin: string, guildId: string) {
  const key = orgLogin.toLowerCase();
  await db
    .insert(schema.githubOrgTrials)
    .values({ orgLogin: key, guildId })
    .onConflictDoNothing();
  const row = await db.query.githubOrgTrials.findFirst({
    where: eq(schema.githubOrgTrials.orgLogin, key),
  });
  if (!row) throw new Error(`org trial row for ${key} vanished after upsert`);
  return row;
}

export async function getOrgTrial(db: Db, orgLogin: string) {
  return (
    (await db.query.githubOrgTrials.findFirst({
      where: eq(schema.githubOrgTrials.orgLogin, orgLogin.toLowerCase()),
    })) ?? null
  );
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

/** Find the guild a Stripe customer belongs to. */
export async function findGuildByStripeCustomer(db: Db, customerId: string) {
  return (
    (await db.query.guilds.findFirst({
      where: eq(schema.guilds.stripeCustomerId, customerId),
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

export async function setGuildStripeCustomer(
  db: Db,
  guildId: string,
  customerId: string,
): Promise<void> {
  await db
    .update(schema.guilds)
    .set({ stripeCustomerId: customerId })
    .where(eq(schema.guilds.id, guildId));
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
} from "./schema.js";
