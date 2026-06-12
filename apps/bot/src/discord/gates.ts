import {
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type APIInteractionGuildMember,
} from "discord.js";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@anywherecode/db";
import type { Guild } from "@anywherecode/db";
import type { Config } from "../config.js";

/** /ask is read-only and cheap, so it gets a looser cap than /code. */
export const ASK_CAP_MULTIPLIER = 4;

const DAY_MS = 86_400_000;

/** Subset of config the guild lifecycle + plan resolution need. */
export type GuildCaps = Pick<
  Config,
  "TRIAL_DAYS" | "PLATFORM_TRIAL_TASK_CAP" | "FREE_TASK_CAP"
>;

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

export function capState(
  guild: Guild,
  mode: "code" | "ask",
  now: Date = new Date(),
): { exceeded: boolean; used: number; cap: number; needsReset: boolean } {
  const needsReset = now >= guild.capResetAt;
  const cap =
    mode === "code" ? guild.taskCap : guild.taskCap * ASK_CAP_MULTIPLIER;
  const used = needsReset
    ? 0
    : mode === "code"
      ? guild.tasksUsedThisMonth
      : guild.asksUsedThisMonth;
  return { exceeded: used >= cap, used, cap, needsReset };
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
  tier: "Trial" | "Pro" | "Free" | "Past due" | "Canceled";
  status: Guild["subStatus"];
  codeCap: number;
  askCap: number;
  trialDaysLeft: number | null;
}

/** Human-facing tier view for `/billing` and the dashboard. */
export function planSummary(guild: Guild, now: Date = new Date()): PlanSummary {
  const askCap = guild.taskCap * ASK_CAP_MULTIPLIER;
  const trialDaysLeft =
    guild.subStatus === "trialing" && guild.trialEndsAt
      ? Math.max(0, Math.ceil((guild.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null;
  const tier: PlanSummary["tier"] =
    guild.subStatus === "active"
      ? "Pro"
      : guild.subStatus === "trialing"
        ? "Trial"
        : guild.subStatus === "past_due"
          ? "Past due"
          : guild.subStatus === "canceled"
            ? "Canceled"
            : "Free";
  return { tier, status: guild.subStatus, codeCap: guild.taskCap, askCap, trialDaysLeft };
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
    now >= existing.trialEndsAt
  ) {
    // Trial elapsed without a paid subscription → free tier.
    updates.subStatus = "free";
    updates.taskCap = config.FREE_TASK_CAP;
  }

  if (Object.keys(updates).length === 0) return existing;
  const [updated] = await db
    .update(schema.guilds)
    .set(updates)
    .where(eq(schema.guilds.id, guildId))
    .returning();
  return updated ?? existing;
}
