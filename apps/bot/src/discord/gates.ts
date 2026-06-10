import {
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type APIInteractionGuildMember,
} from "discord.js";
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/index.js";
import type { Guild } from "../db/schema.js";

/** /ask is read-only and cheap, so it gets a looser cap than /code. */
export const ASK_CAP_MULTIPLIER = 4;

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

/** Fetch-or-create the guild row; rolls the monthly counters when due. */
export async function ensureGuild(
  db: Db,
  guildId: string,
  defaultCap: number,
): Promise<Guild> {
  const existing = await db.query.guilds.findFirst({
    where: eq(schema.guilds.id, guildId),
  });
  if (!existing) {
    const [created] = await db
      .insert(schema.guilds)
      .values({
        id: guildId,
        taskCap: defaultCap,
        capResetAt: nextMonthStart(),
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
  if (new Date() >= existing.capResetAt) {
    const [updated] = await db
      .update(schema.guilds)
      .set({
        tasksUsedThisMonth: 0,
        asksUsedThisMonth: 0,
        capResetAt: nextMonthStart(),
      })
      .where(eq(schema.guilds.id, guildId))
      .returning();
    return updated ?? existing;
  }
  return existing;
}
