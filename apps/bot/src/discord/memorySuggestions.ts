import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ThreadChannel,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@anywherecode/db";
import type { Config } from "../config.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { suggestMemoryRules } from "../llm/memorySuggest.js";
import { captureError } from "../observability.js";
import { canInvoke, ensureGuild, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";

const SUGGESTION_TTL_MS = 72 * 3_600_000;

/**
 * "You've told me twice to avoid X — save that?" After a code task that needed
 * thread corrections, distill candidate rules and post a Save/Dismiss card.
 * Durable row so the buttons survive restarts. Fire-and-forget from the task
 * runner — failures only log.
 */
export async function maybeSuggestMemory(
  deps: { db: Db; config: Config },
  args: {
    guildId: string;
    repoFullName: string;
    taskPrompt: string;
    corrections: Array<{ author: string; text: string }>;
    thread: ThreadChannel;
  },
): Promise<void> {
  if (args.corrections.length === 0) return;
  const guild = await deps.db.query.guilds.findFirst({
    where: eq(schema.guilds.id, args.guildId),
  });
  if (!guild) return;
  const tier = resolveTier(guild);
  if (tier.kind !== "oss" && tier.kind !== "paid") return;

  const resolved = await resolveLlmAuth(deps.db, deps.config, args.guildId);
  if (!resolved.auth) return;
  const memoryRow = await deps.db.query.serverMemories.findFirst({
    where: and(
      eq(schema.serverMemories.guildId, args.guildId),
      eq(schema.serverMemories.repoFullName, args.repoFullName),
    ),
  });
  const currentMemory = memoryRow?.content ?? "";
  const rules = (
    await suggestMemoryRules(resolved.auth, deps.config.CHAT_MODEL, {
      taskPrompt: args.taskPrompt,
      corrections: args.corrections,
      currentMemory,
    })
  ).filter((r) => !currentMemory.includes(r));
  if (rules.length === 0) return;

  const id = randomUUID().slice(0, 8);
  await deps.db.insert(schema.memorySuggestions).values({
    id,
    guildId: args.guildId,
    repoFullName: args.repoFullName,
    rules: rules.join("\n"),
    expiresAt: new Date(Date.now() + SUGGESTION_TTL_MS),
  });
  await args.thread.send({
    content: [
      "💡 Based on the corrections in this thread, save to Server Memory?",
      ...rules.map((r) => `> - ${r}`),
    ].join("\n"),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`aw:memsug:save:${id}`)
          .setLabel("Save to memory")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`aw:memsug:dismiss:${id}`)
          .setLabel("Dismiss")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  });
}

export async function handleMemorySuggestionButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
  sub: "save" | "dismiss",
  suggestionId: string,
): Promise<void> {
  if (!interaction.guildId) return;
  const suggestion = await ctx.db.query.memorySuggestions.findFirst({
    where: eq(schema.memorySuggestions.id, suggestionId),
  });
  if (
    !suggestion ||
    suggestion.guildId !== interaction.guildId ||
    suggestion.status !== "pending" ||
    suggestion.expiresAt < new Date()
  ) {
    await interaction.message.edit({ components: [] }).catch(() => {});
    await interaction.reply({
      content: "This suggestion has expired.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = await ensureGuild(ctx.db, interaction.guildId, ctx.config);
  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to change Server Memory.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "dismiss") {
    await ctx.db
      .update(schema.memorySuggestions)
      .set({ status: "dismissed" })
      .where(eq(schema.memorySuggestions.id, suggestionId));
    await interaction.update({
      content: `~~Memory suggestion~~ — dismissed by ${interaction.user.username}.`,
      components: [],
    });
    return;
  }

  // Atomic claim so two clicks can't double-append.
  const claimed = await ctx.db
    .update(schema.memorySuggestions)
    .set({ status: "saved" })
    .where(
      and(
        eq(schema.memorySuggestions.id, suggestionId),
        eq(schema.memorySuggestions.status, "pending"),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    await interaction.reply({
      content: "Someone already acted on this suggestion.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const memoryRow = await ctx.db.query.serverMemories.findFirst({
    where: and(
      eq(schema.serverMemories.guildId, suggestion.guildId),
      eq(schema.serverMemories.repoFullName, suggestion.repoFullName),
    ),
  });
  const current = memoryRow?.content ?? "";
  const additions = suggestion.rules
    .split("\n")
    .filter((r) => r.trim() && !current.includes(r))
    .map((r) => `- ${r}`)
    .join("\n");
  const next = (current ? `${current}\n${additions}` : additions).slice(
    0,
    ctx.config.MEMORY_MAX_CHARS,
  );
  await ctx.db
    .insert(schema.serverMemories)
    .values({
      guildId: suggestion.guildId,
      repoFullName: suggestion.repoFullName,
      content: next,
      updatedBy: interaction.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.serverMemories.guildId, schema.serverMemories.repoFullName],
      set: { content: next, updatedBy: interaction.user.id, updatedAt: new Date() },
    })
    .catch((err) => captureError(err, { msg: "memory suggestion save failed" }));

  await interaction.update({
    content: `📚 Saved to Server Memory for \`${suggestion.repoFullName}\` by ${interaction.user.username}:\n${suggestion.rules
      .split("\n")
      .map((r) => `> - ${r}`)
      .join("\n")}`,
    components: [],
  });
}
