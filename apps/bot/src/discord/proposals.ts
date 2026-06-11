import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type MessageCreateOptions,
} from "discord.js";
import { and, eq, lt } from "drizzle-orm";
import { schema, type Db } from "../db/index.js";
import type { Proposal } from "../db/schema.js";
import { canInvoke, ensureGuild } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { checkTaskPreconditions, launchTask, truncate } from "./launch.js";

/**
 * Inferred-task proposals. When a mention implies a coding task that nobody
 * explicitly assigned, the bot posts the task with Run/Dismiss buttons instead
 * of starting a container. Run re-checks permissions and caps at click time.
 */

export async function createProposal(
  ctx: BotContext,
  args: {
    guildId: string;
    channelId: string;
    threadId: string | null;
    authorId: string;
    prompt: string;
    summary: string;
    repoFullName: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID().slice(0, 8);
  await ctx.db.insert(schema.proposals).values({
    id,
    guildId: args.guildId,
    channelId: args.channelId,
    threadId: args.threadId,
    repoFullName: args.repoFullName,
    prompt: args.prompt,
    summary: args.summary,
    authorId: args.authorId,
    expiresAt: new Date(
      Date.now() + ctx.config.CHAT_PROPOSAL_TTL_MINUTES * 60_000,
    ),
  });
  return { id };
}

export function proposalMessage(
  summary: string,
  prompt: string,
  proposalId: string,
): MessageCreateOptions {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`aw:proposal:run:${proposalId}`)
      .setLabel("Run it")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`aw:proposal:dismiss:${proposalId}`)
      .setLabel("Dismiss")
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: `Sounds like you want me to: **${truncate(summary, 100)}**\n> ${truncate(prompt, 300)}\nRun it?`,
    components: [row],
    allowedMentions: { parse: [] },
  };
}

export function proposalUsable(
  p: Pick<Proposal, "status" | "expiresAt">,
  now: Date = new Date(),
): boolean {
  return p.status === "pending" && p.expiresAt >= now;
}

export async function handleProposalButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
  sub: "run" | "dismiss",
  proposalId: string,
): Promise<void> {
  if (!interaction.guildId) return;
  const proposal = await ctx.db.query.proposals.findFirst({
    where: eq(schema.proposals.id, proposalId),
  });
  if (
    !proposal ||
    proposal.guildId !== interaction.guildId ||
    !proposalUsable(proposal)
  ) {
    await stripButtons(interaction);
    await interaction.reply({
      content:
        "This proposal has expired — mention me again if you still want it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = await ensureGuild(
    ctx.db,
    interaction.guildId,
    ctx.config.DEFAULT_TASK_CAP,
  );
  const isAuthor = interaction.user.id === proposal.authorId;
  const mayInvoke = Boolean(
    interaction.member && canInvoke(guild, interaction.member),
  );

  if (sub === "dismiss") {
    if (!isAuthor && !mayInvoke) {
      await interaction.reply({
        content: "Only the requester or an authorized member can dismiss this.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await ctx.db
      .update(schema.proposals)
      .set({ status: "dismissed" })
      .where(eq(schema.proposals.id, proposalId));
    await interaction.update({
      content: `~~${truncate(proposal.summary, 100)}~~ — dismissed by ${interaction.user.username}.`,
      components: [],
    });
    return;
  }

  // Run: full gate re-check on the clicker, then atomic claim.
  if (!mayInvoke) {
    await interaction.reply({
      content:
        "You don't have permission to run agent tasks here. Ask an admin to grant your role with `/config role`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const pre = await checkTaskPreconditions(
    ctx,
    guild,
    interaction.member,
    "code",
    proposal.channelId,
  );
  if (!pre.ok) {
    await interaction.reply({
      content: pre.reason,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const claimed = await ctx.db
    .update(schema.proposals)
    .set({ status: "accepted" })
    .where(
      and(
        eq(schema.proposals.id, proposalId),
        eq(schema.proposals.status, "pending"),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    await interaction.reply({
      content: "Someone already acted on this proposal.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    content: `🧵 **${pre.repoFullName}** — ${truncate(proposal.summary, 100)} (started by ${interaction.user.username})`,
    components: [],
  });

  let existingThread = null;
  if (proposal.threadId) {
    const ch = await interaction.client.channels
      .fetch(proposal.threadId)
      .catch(() => null);
    if (ch?.isThread()) existingThread = ch;
  }
  await launchTask(ctx, {
    guildId: proposal.guildId,
    installationId: pre.installationId,
    repoFullName: pre.repoFullName,
    channelId: proposal.channelId,
    mode: "code",
    prompt: proposal.prompt,
    requestedBy: interaction.user.username,
    thread: existingThread
      ? { kind: "existing", thread: existingThread }
      : {
          kind: "create",
          client: interaction.client,
          channelId: proposal.channelId,
          anchorMessageId: interaction.message.id,
          name: `code: ${proposal.summary}`,
        },
  });
}

async function stripButtons(interaction: ButtonInteraction): Promise<void> {
  await interaction.message.edit({ components: [] }).catch(() => {});
}

/** Boot housekeeping: drop long-dead proposal rows. */
export async function sweepExpiredProposals(db: Db): Promise<void> {
  await db
    .delete(schema.proposals)
    .where(lt(schema.proposals.expiresAt, new Date(Date.now() - 7 * 86_400_000)));
}
