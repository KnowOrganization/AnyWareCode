import {
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type APIInteractionGuildMember,
} from "discord.js";
import { eq } from "drizzle-orm";
import { getPlan, schema, type Db } from "@anywarecode/db";
import type { Guild } from "@anywarecode/db";
import type { Config } from "../config.js";

const DAY_MS = 86_400_000;

/** Subset of config the guild lifecycle + plan resolution need. */
export type GuildCaps = Pick<Config, "FREE_TASK_CAP">;

/** Human-facing names per plan row id. */
export const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  oss: "OSS Community",
  pro: "Pro",
  studio: "Studio",
};

/**
 * Single entitlement source. Everything that branches on "what tier is this
 * guild" derives it from here, never from subStatus alone.
 */
export type Tier =
  | { kind: "free" }
  | { kind: "oss" }
  | { kind: "paid"; planId: string };

/**
 * Free is the universal floor: every guild always has at least the Free plan
 * (BYO-LLM). A canceled/lapsed paid plan falls back to Free, never to nothing.
 */
export function resolveTier(guild: Guild): Tier {
  if (
    guild.planId === "oss" &&
    guild.ossStatus === "approved" &&
    guild.subStatus !== "canceled"
  )
    return { kind: "oss" };
  // past_due keeps entitlements (Razorpay charge-retry grace); /billing warns.
  if (
    guild.planId &&
    guild.planId !== "oss" &&
    (guild.subStatus === "active" || guild.subStatus === "past_due")
  )
    return { kind: "paid", planId: guild.planId };
  return { kind: "free" };
}

/** Whether pack tasks may be spent right now. Every tier is entitled, so packs
 * are always spendable; refunds and the cap math both rely on this. */
export function packSpendable(_guild: Guild): boolean {
  return true;
}

/** Whether the guild's plan carries a machine feature flag (e.g. model_select). */
export async function planHasFeature(
  db: Db,
  planId: string | null,
  feature: string,
): Promise<boolean> {
  const plan = planId ? await getPlan(db, planId) : null;
  return Boolean(plan?.features.includes(feature));
}

export function canInvoke(
  guild: Guild,
  member: GuildMember | APIInteractionGuildMember,
): boolean {
  const perms =
    member instanceof GuildMember
      ? member.permissions
      : new PermissionsBitField(BigInt(member.permissions));
  if (perms.has(PermissionFlagsBits.ManageGuild)) return true;
  if (guild.allowedRoleId) {
    const roleIds =
      member instanceof GuildMember
        ? [...member.roles.cache.keys()]
        : member.roles;
    return roleIds.includes(guild.allowedRoleId);
  }
  return false;
}

export interface CapState {
  exceeded: boolean;
  used: number;
  cap: number;
  needsReset: boolean;
  /** /ask is unlimited on every plan. */
  unlimited: boolean;
  /** Pack tasks available to spend once the plan cap is exhausted. */
  packRemaining: number;
}

export function capState(
  guild: Guild,
  mode: "code" | "ask",
  now: Date = new Date(),
): CapState {
  const needsReset = now >= guild.capResetAt;
  // /ask is read-only and unmetered on every tier.
  if (mode === "ask") {
    return {
      exceeded: false,
      used: needsReset ? 0 : guild.asksUsedThisMonth,
      cap: Number.POSITIVE_INFINITY,
      needsReset,
      unlimited: true,
      packRemaining: 0,
    };
  }
  const cap = guild.taskCap;
  const used = needsReset ? 0 : guild.tasksUsedThisMonth;
  // Packs fund code tasks once the monthly plan cap is exhausted.
  const packRemaining = packSpendable(guild) ? guild.packTasksRemaining : 0;
  return {
    exceeded: used >= cap && packRemaining <= 0,
    used,
    cap,
    needsReset,
    unlimited: false,
    packRemaining,
  };
}

export function nextMonthStart(from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}

export interface PlanSummary {
  /** Display label, e.g. "Free", "Pro", "Pro (payment overdue)". */
  tier: string;
  status: Guild["subStatus"];
  codeCap: number;
  /** Always Infinity — /ask is unlimited on every plan. */
  askCap: number;
  packRemaining: number;
}

/** Human-facing tier view for `/billing` and the dashboard. */
export function planSummary(guild: Guild, _now: Date = new Date()): PlanSummary {
  const resolved = resolveTier(guild);
  const tier =
    resolved.kind === "oss"
      ? (PLAN_LABELS["oss"] ?? "OSS Community")
      : resolved.kind === "paid"
        ? `${PLAN_LABELS[resolved.planId] ?? resolved.planId}${
            guild.subStatus === "past_due" ? " (payment overdue)" : ""
          }`
        : (PLAN_LABELS["free"] ?? "Free");
  return {
    tier,
    status: guild.subStatus,
    codeCap: guild.taskCap,
    askCap: Number.POSITIVE_INFINITY,
    packRemaining: guild.packTasksRemaining,
  };
}

/**
 * Fetch-or-create the guild row. New guilds land on Free immediately (BYO-LLM —
 * there is no platform-key trial). Handles lazy state transitions on every call:
 * monthly counter reset, the Discord-rail lazy cancel backstop, and the Free
 * floor (any guild not on an active paid plan or an approved OSS grant sits on
 * Free with the Free cap). The Razorpay webhook sets taskCap for paid tiers.
 */
export async function ensureGuild(
  db: Db,
  guildId: string,
  config: GuildCaps,
  now: Date = new Date(),
): Promise<Guild> {
  const existing = await db.query.guilds.findFirst({
    where: eq(schema.guilds.id, guildId),
  });
  if (!existing) {
    const [created] = await db
      .insert(schema.guilds)
      .values({
        id: guildId,
        planId: "free",
        taskCap: config.FREE_TASK_CAP,
        concurrency: 1,
        capResetAt: nextMonthStart(now),
        subStatus: "free",
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Lost a race with a concurrent insert; the row exists now.
    const row = await db.query.guilds.findFirst({
      where: eq(schema.guilds.id, guildId),
    });
    if (!row) throw new Error(`guild ${guildId} vanished during upsert`);
    return row;
  }

  const updates: Partial<typeof schema.guilds.$inferInsert> = {};
  if (now >= existing.capResetAt) {
    // Monthly counters only — packTasksRemaining survives resets.
    updates.tasksUsedThisMonth = 0;
    updates.asksUsedThisMonth = 0;
    updates.capResetAt = nextMonthStart(now);
  }
  if (
    existing.subSource === "discord" &&
    existing.subStatus === "active" &&
    existing.currentPeriodEnd &&
    now.getTime() > existing.currentPeriodEnd.getTime() + DAY_MS
  ) {
    // Discord never reliably signals subscription end; the entitlement sweep
    // normally refreshes/cancels first — this is the lazy backstop, with 24h
    // of grace for a renewal event the sweep hasn't replayed yet. Drops to Free.
    updates.subStatus = "free";
    updates.subSource = null;
    updates.planId = "free";
    updates.taskCap = config.FREE_TASK_CAP;
    updates.concurrency = 1;
  }

  // Free floor: normalize any guild that resolves to Free (new, lapsed, or
  // canceled paid) onto the Free plan row + cap. Skips paid/OSS guilds.
  const merged = { ...existing, ...updates } as Guild;
  if (resolveTier(merged).kind === "free") {
    if (merged.planId !== "free") updates.planId = "free";
    if (merged.subStatus !== "free") updates.subStatus = "free";
    if (merged.taskCap !== config.FREE_TASK_CAP)
      updates.taskCap = config.FREE_TASK_CAP;
    if (merged.concurrency !== 1) updates.concurrency = 1;
  }

  if (Object.keys(updates).length === 0) return existing;
  const [updated] = await db
    .update(schema.guilds)
    .set(updates)
    .where(eq(schema.guilds.id, guildId))
    .returning();
  return updated ?? existing;
}
