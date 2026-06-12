import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { and, eq, lte } from "drizzle-orm";
import { schema } from "@anywherecode/db";
import { computeNextRun } from "../discord/schedule.js";
import type { BotContext } from "../discord/interactions.js";
import { createProposal, setProposalMessageId } from "../discord/proposals.js";
import { truncate } from "../discord/launch.js";
import { captureError, log } from "../observability.js";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Fires due schedules as proposal cards. The optimistic claim (UPDATE …
 * WHERE next_run_at = observed) makes a multi-instance future safe, and
 * computing the next run from NOW (not from the missed slot) means downtime
 * never causes a replay storm — a missed window fires once.
 */
export function startScheduler(ctx: BotContext): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepDueSchedules(ctx).catch((err) =>
      captureError(err, { msg: "schedule sweep failed" }),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

export async function sweepDueSchedules(ctx: BotContext): Promise<void> {
  const due = await ctx.db.query.schedules.findMany({
    where: and(
      eq(schema.schedules.enabled, true),
      lte(schema.schedules.nextRunAt, new Date()),
    ),
  });
  for (const s of due) {
    const claimed = await ctx.db
      .update(schema.schedules)
      .set({
        nextRunAt: computeNextRun(s.cadence, s.hourUtc, s.dayOfWeek),
        lastRunAt: new Date(),
      })
      .where(
        and(
          eq(schema.schedules.id, s.id),
          eq(schema.schedules.nextRunAt, s.nextRunAt),
        ),
      )
      .returning({ id: schema.schedules.id });
    if (claimed.length === 0) continue; // another instance fired it

    try {
      const { id } = await createProposal(ctx, {
        guildId: s.guildId,
        channelId: s.channelId,
        threadId: null,
        authorId: s.createdBy,
        prompt: s.prompt,
        summary: truncate(s.prompt.split("\n")[0] ?? "scheduled task", 80),
        repoFullName: s.repoFullName,
        source: "schedule",
        scheduleId: s.id,
        ttlMs: ctx.config.SCHEDULE_PROPOSAL_TTL_HOURS * 3_600_000,
      });
      const channel = await ctx.client.channels
        .fetch(s.channelId)
        .catch(() => null);
      if (!channel?.isSendable()) throw new Error("schedule channel unsendable");
      const message = await channel.send({
        content: `🌙 **Scheduled:** ${truncate(s.prompt, 300)}\nRun it?`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`aw:proposal:run:${id}`)
              .setLabel("Run it")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`aw:proposal:dismiss:${id}`)
              .setLabel("Dismiss")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      });
      await setProposalMessageId(ctx.db, id, message.id);
      if (s.failCount > 0) {
        await ctx.db
          .update(schema.schedules)
          .set({ failCount: 0 })
          .where(eq(schema.schedules.id, s.id));
      }
    } catch (err) {
      captureError(err, { msg: "schedule card post failed", scheduleId: s.id });
      const next = s.failCount + 1;
      await ctx.db
        .update(schema.schedules)
        .set(next >= 3 ? { failCount: next, enabled: false } : { failCount: next })
        .where(eq(schema.schedules.id, s.id));
      if (next >= 3) {
        log.warn({ scheduleId: s.id }, "schedule disabled after 3 post failures");
      }
    }
  }
}
