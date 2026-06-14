import {
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type APIInteractionGuildMember,
} from "discord.js";
import { eq } from "drizzle-orm";
import { getPlan, schema, type Db } from "@anywherecode/db";
import type { Guild } from "@anywherecode/db";
import type { Config } from "../config.js";

/** /ask is read-only and cheap, so it gets a looser cap than /code. */
export const ASK_CAP_MULTIPLIER = 4;

const DAY_MS = 86_400_000;

/** Subset of config the guild lifecycle + plan resolution need. */
export type GuildCaps = Pick<Config, "TRIAL_DAYS" | "PLATFORM_TRIAL_TASK_CAP">;

/** Human-facing names per plan row id. */
export const PLAN_LABELS: Record<string, string> = {
  oss: "OSS Community",
  pro: "Pro",
  studio: "Studio",
};

/**
 * Single entitlement source. Everything that branches on "what tier is this
 * guild" derives it from here, never from subStatus alone.
 */
export type Tier =
  | { kind: "trial" }
  | { kind: "oss" }
  | { kind: "paid"; planId: string }
  | { kind: "none"; reason: "trial_expired" | "canceled" };

export function resolveTier(guild: Guild): Tier {
  if (guild.subStatus === "trialing") return { kind: "trial" };
  if (guild.planId === "oss" && guild.ossStatus === "approved")
    return { kind: "oss" };
  // past_due keeps entitlements (Stripe retry grace); /billing shows a warning.
  if (
    guild.planId &&
    (guild.subStatus === "active" || guild.subStatus === "past_due")
  )
    return { kind: "paid", planId: guild.planId };
  return {
    kind: "none",
    reason: guild.subStatus === "canceled" ? "canceled" : "trial_expired",
  };
}

/** Whether pack tasks may be spent right now (never during trial/none). */
export function packSpendable(guild: Guild): boolean {
  const tier = resolveTier(guild);
  return tier.kind === "oss" || tier.kind === "paid";
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
  /** OSS tier gets unlimited /ask. */
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
  const tier = resolveTier(guild);
  if (tier.kind === "oss" && mode === "ask") {
    return {
      exceeded: false,
      used: needsReset ? 0 : guild.asksUsedThisMonth,
      cap: Number.POSITIVE_INFINITY,
      needsReset,
      unlimited: true,
      packRemaining: 0,
    };
  }
  const cap =
    mode === "code" ? guild.taskCap : guild.taskCap * ASK_CAP_MULTIPLIER;
  const used = needsReset
    ? 0
    : mode === "code"
      ? guild.tasksUsedThisMonth
      : guild.asksUsedThisMonth;
  // Packs fund code tasks only, and only on tiers where they're spendable.
  const packRemaining =
    mode === "code" && packSpendable(guild) ? guild.packTasksRemaining : 0;
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

/**
 * Whether the guild may use the platform LLM key. Only during an active trial;
 * paid tiers and the post-trial free tier must bring their own credential.
 */
export function allowPlatformKey(guild: Guild): boolean {
  return guild.subStatus === "trialing";
}

export interface PlanSummary {
  /** Display label, e.g. "Pro", "Pro (payment overdue)", "Trial", "No plan". */
  tier: string;
  status: Guild["subStatus"];
  codeCap: number;
  askCap: number;
  /** Infinity when unlimited (OSS /ask). */
  trialDaysLeft: number | null;
  packRemaining: number;
}

/** Human-facing tier view for `/billing` and the dashboard. */
export function planSummary(guild: Guild, now: Date = new Date()): PlanSummary {
  const resolved = resolveTier(guild);
  const askCap =
    resolved.kind === "oss"
      ? Number.POSITIVE_INFINITY
      : guild.taskCap * ASK_CAP_MULTIPLIER;
  const trialDaysLeft =
    resolved.kind === "trial" && guild.trialEndsAt
      ? Math.max(0, Math.ceil((guild.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null;
  const tier =
    resolved.kind === "trial"
      ? "Trial"
      : resolved.kind === "oss"
        ? (PLAN_LABELS["oss"] ?? "OSS Community")
        : resolved.kind === "paid"
          ? `${PLAN_LABELS[resolved.planId] ?? resolved.planId}${
              guild.subStatus === "past_due" ? " (payment overdue)" : ""
            }`
          : resolved.reason === "canceled"
            ? "Canceled"
            : "No plan";
  return {
    tier,
    status: guild.subStatus,
    codeCap: guild.taskCap,
    askCap,
    trialDaysLeft,
    packRemaining: guild.packTasksRemaining,
  };
}

/**
 * Fetch-or-create the guild row. Handles lazy state transitions on every call:
 * monthly counter reset, and trial→free when the trial window has passed
 * (effective cap lives on `guild.taskCap`; the Stripe webhook sets it for paid
 * tiers).
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
        taskCap: config.PLATFORM_TRIAL_TASK_CAP,
        capResetAt: nextMonthStart(now),
        subStatus: "trialing",
        trialEndsAt: new Date(now.getTime() + config.TRIAL_DAYS * DAY_MS),
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
  // Backfill a trial for rows created before billing existed.
  if (existing.subStatus === "trialing" && !existing.trialEndsAt) {
    updates.trialEndsAt = new Date(now.getTime() + config.TRIAL_DAYS * DAY_MS);
    updates.taskCap = config.PLATFORM_TRIAL_TASK_CAP;
  } else if (
    existing.subStatus === "trialing" &&
    existing.trialEndsAt &&
    now >= existing.trialEndsAt &&
    existing.planId === null
  ) {
    // Trial elapsed without a plan → no entitlements. The planId guard keeps
    // this from clobbering an OSS grant or a paid plan that landed mid-trial.
    updates.subStatus = "free";
    updates.taskCap = 0;
    updates.concurrency = 1;
  } else if (
    existing.subSource === "discord" &&
    existing.subStatus === "active" &&
    existing.currentPeriodEnd &&
    now.getTime() > existing.currentPeriodEnd.getTime() + DAY_MS
  ) {
    // Discord never reliably signals subscription end; the entitlement sweep
    // normally refreshes/cancels first — this is the lazy backstop, with 24h
    // of grace for a renewal event the sweep hasn't replayed yet.
    updates.subStatus = "canceled";
    updates.subSource = null;
    updates.planId = null;
    updates.taskCap = 0;
    updates.concurrency = 1;
  }

  if (Object.keys(updates).length === 0) return existing;
  const [updated] = await db
    .update(schema.guilds)
    .set(updates)
    .where(eq(schema.guilds.id, guildId))
    .returning();
  return updated ?? existing;
}
