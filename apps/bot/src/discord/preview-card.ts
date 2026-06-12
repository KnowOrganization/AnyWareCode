import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
} from "discord.js";
import { eq } from "drizzle-orm";
import { schema, type Db, type Task } from "@anywherecode/db";
import { captureError } from "../observability.js";

/**
 * The PR card's button row. Built in one place so the Preview slot can be
 * re-rendered (placeholder button → live Link) by the click handler and the
 * deployment_status webhook alike. The non-coder trust layer: see it live
 * before anyone merges.
 */
export function prCardButtons(
  taskId: string,
  prUrl: string,
  previewUrl: string | null,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`aw:merge:${taskId}`)
      .setLabel("Merge")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`aw:iterate:${taskId}`)
      .setLabel("Iterate")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel("View on GitHub")
      .setStyle(ButtonStyle.Link)
      .setURL(prUrl),
    previewUrl
      ? new ButtonBuilder()
          .setLabel("Preview ↗")
          .setStyle(ButtonStyle.Link)
          .setURL(previewUrl)
      : new ButtonBuilder()
          .setCustomId(`aw:preview:${taskId}`)
          .setLabel("Preview")
          .setStyle(ButtonStyle.Secondary),
  );
}

/** Persist the preview URL and swap the card's Preview button to a link. */
export async function applyPreviewToCard(
  deps: { db: Db; client: Client },
  task: Task,
  previewUrl: string,
): Promise<void> {
  await deps.db
    .update(schema.tasks)
    .set({ previewUrl })
    .where(eq(schema.tasks.id, task.id));
  if (!task.prMessageId || !task.prNumber) return;
  try {
    const thread = await deps.client.channels.fetch(task.threadId);
    if (!thread?.isThread()) return;
    const message = await thread.messages.fetch(task.prMessageId);
    const prUrl = `https://github.com/${task.repoFullName}/pull/${task.prNumber}`;
    await message.edit({
      components: [prCardButtons(task.id, prUrl, previewUrl)],
    });
  } catch (err) {
    captureError(err, { msg: "preview card edit failed", taskId: task.id });
  }
}
