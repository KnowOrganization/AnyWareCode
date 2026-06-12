import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { schema, type Guild } from "@anywherecode/db";
import { canInvoke, ensureGuild, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { checkTaskPreconditions, launchTask } from "./launch.js";
import { memoryTemplates } from "./memoryTemplates.js";
import { maybeRequirePlanVote } from "./plan-votes.js";
import { setProposalMessageId } from "./proposals.js";

/**
 * Server Memory: a per-repo conventions doc, loaded into every agent run.
 * Viewing is open to everyone; writes need canInvoke + a tier with the
 * feature (pro/studio/oss). The whole doc round-trips through a modal, hence
 * the MEMORY_MAX_CHARS (= Discord modal max) cap.
 */

function memoryWritable(guild: Guild): boolean {
  const tier = resolveTier(guild);
  return tier.kind === "oss" || tier.kind === "paid";
}

async function repoForChannel(
  ctx: BotContext,
  channelId: string,
): Promise<string | null> {
  const row = await ctx.db.query.channelRepos.findFirst({
    where: eq(schema.channelRepos.channelId, channelId),
  });
  return row?.repoFullName ?? null;
}

async function loadMemory(
  ctx: BotContext,
  guildId: string,
  repoFullName: string,
): Promise<string> {
  const row = await ctx.db.query.serverMemories.findFirst({
    where: and(
      eq(schema.serverMemories.guildId, guildId),
      eq(schema.serverMemories.repoFullName, repoFullName),
    ),
  });
  return row?.content ?? "";
}

export async function saveMemory(
  ctx: BotContext,
  guildId: string,
  repoFullName: string,
  content: string,
  updatedBy: string,
): Promise<void> {
  const capped = content.slice(0, ctx.config.MEMORY_MAX_CHARS);
  await ctx.db
    .insert(schema.serverMemories)
    .values({ guildId, repoFullName, content: capped, updatedBy })
    .onConflictDoUpdate({
      target: [schema.serverMemories.guildId, schema.serverMemories.repoFullName],
      set: { content: capped, updatedBy, updatedAt: new Date() },
    });
}

export async function handleMemoryCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();
  const repoFullName = await repoForChannel(ctx, interaction.channelId);
  if (!repoFullName) {
    await interaction.reply({
      content: "No repo set for this channel — run `/repo set` first. Memory is per repo.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);

  if (sub === "view") {
    const content = await loadMemory(ctx, guildId, repoFullName);
    await interaction.reply({
      content: content
        ? `📚 **Server Memory for \`${repoFullName}\`:**\n\`\`\`md\n${content.slice(0, 1800)}\n\`\`\``
        : `No Server Memory for \`${repoFullName}\` yet. Start with \`/memory template\` or \`/memory edit\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Everything below writes.
  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to change Server Memory.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!memoryWritable(guild)) {
    await interaction.reply({
      content: "Server Memory needs a plan (OSS Community, Pro, or Studio). See `/billing`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "clear") {
    await ctx.db
      .delete(schema.serverMemories)
      .where(
        and(
          eq(schema.serverMemories.guildId, guildId),
          eq(schema.serverMemories.repoFullName, repoFullName),
        ),
      );
    await interaction.reply(`🧹 Server Memory for \`${repoFullName}\` cleared.`);
    return;
  }

  if (sub === "template") {
    const name = interaction.options.getString("name", true);
    const template = memoryTemplates[name];
    if (!template) {
      await interaction.reply({
        content: `Unknown template. Available: ${Object.keys(memoryTemplates).join(", ")}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await saveMemory(ctx, guildId, repoFullName, template, interaction.user.id);
    await interaction.reply(
      `📚 Applied the \`${name}\` template to \`${repoFullName}\`. Tune it with \`/memory edit\`.`,
    );
    return;
  }

  if (sub === "add") {
    const rule = interaction.options.getString("rule", true).trim();
    const current = await loadMemory(ctx, guildId, repoFullName);
    const next = current ? `${current}\n- ${rule}` : `- ${rule}`;
    if (next.length > ctx.config.MEMORY_MAX_CHARS) {
      await interaction.reply({
        content: `Memory is full (${ctx.config.MEMORY_MAX_CHARS} chars). Trim it with \`/memory edit\` first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await saveMemory(ctx, guildId, repoFullName, next, interaction.user.id);
    await interaction.reply(`📚 Added to \`${repoFullName}\` memory: ${rule}`);
    return;
  }

  if (sub === "commit") {
    // AGENTS.md interop: conventions captured in Discord flow back to the
    // repo, where every standards-aware agent can read them. Full code-task
    // pipeline — plan votes, receipts, PR review all apply.
    const content = await loadMemory(ctx, guildId, repoFullName);
    if (!content.trim()) {
      await interaction.reply({
        content: "Server Memory is empty — nothing to commit. Add rules first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const prompt = [
      `Merge the following team conventions into the AGENTS.md file at the repository root (create it if missing). Preserve any existing AGENTS.md content and structure; integrate these rules where they fit, dedupe against rules already present, and keep the file readable:`,
      "<conventions>",
      content,
      "</conventions>",
    ].join("\n");
    const pre = await checkTaskPreconditions(
      ctx,
      guild,
      interaction.member,
      "code",
      { channelId: interaction.channelId },
      prompt,
    );
    if (!pre.ok) {
      await interaction.reply({ content: pre.reason, flags: MessageFlags.Ephemeral });
      return;
    }
    const decision = await maybeRequirePlanVote(ctx, {
      guild,
      authorId: interaction.user.id,
      repoFullName: pre.repoFullName,
      channelId: interaction.channelId,
      prompt,
      summary: "Commit Server Memory to AGENTS.md",
    });
    if (decision.kind === "vote") {
      await interaction.reply({
        content: decision.card.content ?? "",
        components: decision.card.components ?? [],
        allowedMentions: { parse: [] },
      });
      const card = await interaction.fetchReply();
      await setProposalMessageId(ctx.db, decision.proposalId, card.id);
      return;
    }
    await interaction.reply(
      `📚→📦 **${pre.repoFullName}** — committing Server Memory to AGENTS.md`,
    );
    const reply = await interaction.fetchReply();
    await launchTask(ctx, {
      guildId,
      installationId: pre.installationId,
      repoFullName: pre.repoFullName,
      channelId: interaction.channelId,
      mode: "code",
      prompt,
      requestedBy: interaction.user.username,
      requestedById: interaction.user.id,
      thread: {
        kind: "create",
        client: interaction.client,
        channelId: interaction.channelId,
        anchorMessageId: reply.id,
        name: "code: commit memory to AGENTS.md",
      },
    });
    return;
  }

  if (sub === "edit") {
    const current = await loadMemory(ctx, guildId, repoFullName);
    const modal = new ModalBuilder()
      .setCustomId("aw:memory_modal")
      .setTitle("Edit Server Memory")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("content")
            .setLabel(`Conventions for this channel's repo`)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(ctx.config.MEMORY_MAX_CHARS)
            .setRequired(false)
            .setValue(current.slice(0, ctx.config.MEMORY_MAX_CHARS)),
        ),
      );
    await interaction.showModal(modal);
  }
}

export async function handleMemoryModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const repoFullName = await repoForChannel(ctx, interaction.channelId ?? "");
  if (!repoFullName) {
    await interaction.reply({
      content: "This channel lost its repo binding — run `/repo set` again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Re-gate at submit time (perms may have changed while the modal was open).
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  if (
    !interaction.member ||
    !canInvoke(guild, interaction.member) ||
    !memoryWritable(guild)
  ) {
    await interaction.reply({
      content: "You don't have permission to change Server Memory.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const content = interaction.fields.getTextInputValue("content").trim();
  if (!content) {
    await ctx.db
      .delete(schema.serverMemories)
      .where(
        and(
          eq(schema.serverMemories.guildId, guildId),
          eq(schema.serverMemories.repoFullName, repoFullName),
        ),
      );
    await interaction.reply(`🧹 Server Memory for \`${repoFullName}\` cleared.`);
    return;
  }
  await saveMemory(ctx, guildId, repoFullName, content, interaction.user.id);
  await interaction.reply(
    `📚 Server Memory for \`${repoFullName}\` updated (${content.length} chars). It loads into every run.`,
  );
}
