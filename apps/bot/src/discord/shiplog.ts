import { EmbedBuilder, type Client } from "discord.js";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db, type Task } from "@anywarecode/db";
import { captureError } from "../observability.js";
import { truncate } from "./launch.js";

/**
 * Ship Log: merged agent PRs auto-post to a configured channel — the
 * build-in-public engine. Two triggers race (Merge button + the
 * pull_request.closed webhook); the conditional UPDATE on
 * `shiplog_posted_at IS NULL` guarantees exactly one post.
 */
export async function postShipLog(
  deps: { db: Db; client: Client },
  task: Task,
  mergedBy: string | null,
): Promise<void> {
  const claimed = await deps.db
    .update(schema.tasks)
    .set({ shiplogPostedAt: new Date() })
    .where(
      and(eq(schema.tasks.id, task.id), isNull(schema.tasks.shiplogPostedAt)),
    )
    .returning({ id: schema.tasks.id });
  if (claimed.length === 0) return; // the other trigger won

  const guild = await deps.db.query.guilds.findFirst({
    where: eq(schema.guilds.id, task.guildId),
  });
  if (!guild?.shiplogChannelId) return;
  const channel = await deps.client.channels
    .fetch(guild.shiplogChannelId)
    .catch(() => null);
  if (!channel?.isSendable()) return;

  const prUrl = `https://github.com/${task.repoFullName}/pull/${task.prNumber}`;
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🚢 Shipped: ${truncate(task.prompt.split("\n")[0] ?? "a change", 200)}`)
    .setURL(prUrl)
    .setDescription(`\`${task.repoFullName}\` — [PR #${task.prNumber}](${prUrl})`)
    .addFields(
      { name: "Sponsor", value: task.requestedBy, inline: true },
      ...(task.planApprovedBy
        ? [{ name: "Plan approved by", value: task.planApprovedBy, inline: true }]
        : []),
      ...(mergedBy ? [{ name: "Merged by", value: mergedBy, inline: true }] : []),
      ...(task.previewUrl
        ? [{ name: "Preview", value: task.previewUrl, inline: true }]
        : []),
    )
    .setFooter({ text: "shipped with AnyWareCode" })
    .setTimestamp(new Date());

  await channel
    .send({ embeds: [embed], allowedMentions: { parse: [] } })
    .catch((err) =>
      captureError(err, { msg: "ship log post failed", guildId: task.guildId }),
    );
}
