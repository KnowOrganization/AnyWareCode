import { randomUUID } from "node:crypto";
import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { getPlan, schema, type Guild, type Schedule } from "@anywherecode/db";
import { canInvoke, ensureGuild, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { truncate } from "./launch.js";

/**
 * "The night shift": recurring jobs that surface as proposal cards — a human
 * Run click is always between a schedule and a container, so the schedule
 * itself never spends quota or runs unattended.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Next firing strictly after `from`. Weekly uses dayOfWeek (0=Sunday, UTC). */
export function computeNextRun(
  cadence: Schedule["cadence"],
  hourUtc: number,
  dayOfWeek: number | null,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (cadence === "daily") {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  const target = dayOfWeek ?? 0;
  const delta = (target - next.getUTCDay() + 7) % 7;
  next.setUTCDate(next.getUTCDate() + delta);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

/** Per-guild schedule allowance: plan feature → config cap, trial → 1, else 0. */
export async function scheduleAllowance(
  ctx: Pick<BotContext, "db" | "config">,
  guild: Guild,
): Promise<number> {
  const tier = resolveTier(guild);
  if (tier.kind === "trial") return 1;
  if (tier.kind === "paid" || tier.kind === "oss") {
    const plan = await getPlan(ctx.db, tier.kind === "oss" ? "oss" : tier.planId);
    if (plan?.features.includes("scheduled_tasks")) {
      return ctx.config.SCHEDULE_MAX_PER_GUILD;
    }
  }
  return 0;
}

export async function handleScheduleCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const rows = await ctx.db.query.schedules.findMany({
      where: eq(schema.schedules.guildId, guildId),
    });
    if (rows.length === 0) {
      await interaction.reply({
        content: "No schedules. Add one with `/schedule add`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = rows.map((s) => {
      const when =
        s.cadence === "daily"
          ? `daily ${s.hourUtc}:00 UTC`
          : `${DAY_NAMES[s.dayOfWeek ?? 0]}s ${s.hourUtc}:00 UTC`;
      return `${s.enabled ? "🌙" : "💤"} \`${s.id}\` ${when} — \`${s.repoFullName}\`: ${truncate(s.prompt, 80)}`;
    });
    await interaction.reply({
      content: lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to manage schedules here.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "remove") {
    const id = interaction.options.getString("id", true);
    const deleted = await ctx.db
      .delete(schema.schedules)
      .where(
        and(eq(schema.schedules.id, id), eq(schema.schedules.guildId, guildId)),
      )
      .returning({ id: schema.schedules.id });
    await interaction.reply(
      deleted.length > 0
        ? `🗑️ Schedule \`${id}\` removed.`
        : `No schedule \`${id}\` here — check \`/schedule list\`.`,
    );
    return;
  }

  // add
  const repoRow = await ctx.db.query.channelRepos.findFirst({
    where: eq(schema.channelRepos.channelId, interaction.channelId),
  });
  if (!repoRow) {
    await interaction.reply({
      content: "No repo set for this channel — run `/repo set` first. Scheduled cards post here.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const allowance = await scheduleAllowance(ctx, guild);
  const existing = await ctx.db.query.schedules.findMany({
    where: eq(schema.schedules.guildId, guildId),
  });
  if (existing.length >= allowance) {
    await interaction.reply({
      content:
        allowance === 0
          ? "Scheduled tasks need a plan with the feature (Pro or Studio). See `/billing`."
          : `This server is at its schedule limit (${allowance}). Remove one with \`/schedule remove\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prompt = interaction.options.getString("prompt", true);
  const cadence = interaction.options.getString("cadence", true) as
    | "daily"
    | "weekly";
  const hourUtc = interaction.options.getInteger("hour_utc", true);
  const dayOfWeek = interaction.options.getInteger("day");
  if (cadence === "weekly" && dayOfWeek === null) {
    await interaction.reply({
      content: "Weekly schedules need a `day` (0 = Sunday … 6 = Saturday).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = randomUUID().slice(0, 8);
  const nextRunAt = computeNextRun(cadence, hourUtc, dayOfWeek);
  await ctx.db.insert(schema.schedules).values({
    id,
    guildId,
    channelId: interaction.channelId,
    repoFullName: repoRow.repoFullName,
    prompt,
    cadence,
    hourUtc,
    dayOfWeek,
    nextRunAt,
    createdBy: interaction.user.id,
  });
  await interaction.reply(
    `🌙 Scheduled \`${id}\`: ${cadence === "daily" ? "every day" : `every ${DAY_NAMES[dayOfWeek ?? 0]}`} at ${hourUtc}:00 UTC — first card <t:${Math.floor(nextRunAt.getTime() / 1000)}:R>. Each run posts a proposal here; nothing runs without a human click.`,
  );
}
