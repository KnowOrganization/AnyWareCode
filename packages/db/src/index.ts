import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
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

/** Apply a Stripe subscription change to a guild. The effective cap is copied
 * onto guilds.taskCap so the bot's capState needs no plan join in the hot path. */
export async function applyGuildSubscription(
  db: Db,
  guildId: string,
  patch: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string | null;
    subStatus: "active" | "past_due" | "canceled" | "free";
    planId?: string | null;
    taskCap?: number;
    currentPeriodEnd?: Date | null;
  },
): Promise<void> {
  await db
    .update(schema.guilds)
    .set(patch)
    .where(eq(schema.guilds.id, guildId));
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
} from "./schema.js";
