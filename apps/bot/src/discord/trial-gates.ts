import type { Client } from "discord.js";
import { eq } from "drizzle-orm";
import { schema, type Db, type Guild } from "@anywherecode/db";
import type { Config } from "../config.js";
import { captureError } from "../observability.js";

/**
 * Abuse gates for the platform-key trial. Only consulted when a task would
 * spend platform money (resolveLlmAuth source === "platform"); BYO-key guilds
 * never hit this. A pass is cached on guilds.trialGatesPassedAt forever.
 */

const DAY_MS = 86_400_000;
const DISCORD_EPOCH_MS = 1_420_070_400_000;
/** Above this size we skip the full member fetch (cost) — the gate passes. */
const MEMBER_FETCH_CEILING = 200;

/** Creation time encoded in a Discord snowflake. */
export function guildCreatedAt(guildId: string): Date {
  return new Date(Number(BigInt(guildId) >> 22n) + DISCORD_EPOCH_MS);
}

export type TrialGateResult = { ok: true } | { ok: false; reason: string };

export async function checkTrialGates(
  client: Client,
  db: Db,
  config: Pick<Config, "TRIAL_MIN_SERVER_AGE_DAYS" | "TRIAL_MIN_HUMAN_MEMBERS">,
  guild: Guild,
  now: Date = new Date(),
): Promise<TrialGateResult> {
  if (guild.trialGatesPassedAt) return { ok: true };

  const ageDays =
    (now.getTime() - guildCreatedAt(guild.id).getTime()) / DAY_MS;
  if (ageDays < config.TRIAL_MIN_SERVER_AGE_DAYS) {
    return {
      ok: false,
      reason: `The free trial needs a server at least ${config.TRIAL_MIN_SERVER_AGE_DAYS} days old. Connect your own LLM key with \`/connect llm\` to start now.`,
    };
  }

  let humanMembers = config.TRIAL_MIN_HUMAN_MEMBERS;
  try {
    const discordGuild = await client.guilds.fetch(guild.id);
    if (discordGuild.memberCount <= MEMBER_FETCH_CEILING) {
      const members = await discordGuild.members.fetch();
      humanMembers = members.filter((m) => !m.user.bot).size;
    }
    // Bigger servers trivially pass — a farm won't recruit 200+ members.
  } catch (err) {
    // Can't verify (missing intent/permissions): fail open rather than block
    // legitimate servers; the org-trial dedup + runtime cap still apply.
    captureError(err, { msg: "trial gate member fetch failed", guildId: guild.id });
  }
  if (humanMembers < config.TRIAL_MIN_HUMAN_MEMBERS) {
    return {
      ok: false,
      reason: `The free trial needs at least ${config.TRIAL_MIN_HUMAN_MEMBERS} human members in the server. Connect your own LLM key with \`/connect llm\` to start now.`,
    };
  }

  await db
    .update(schema.guilds)
    .set({ trialGatesPassedAt: now })
    .where(eq(schema.guilds.id, guild.id));
  return { ok: true };
}
