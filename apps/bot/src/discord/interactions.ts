import {
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type ThreadChannel,
} from "discord.js";
import { and, eq, inArray } from "drizzle-orm";
import type { Config } from "../config.js";
import { schema, type Db } from "@anywherecode/db";
import type { GitHubService } from "../github/app.js";
import { createInstallState } from "../github/install-state.js";
import type { TaskOrchestrator } from "../orchestrator/taskRunner.js";
import { canInvoke, capState, ensureGuild, resolveTier } from "./gates.js";
import {
  handleBillingCommand,
  handleConnectCommand,
  handleLlmButton,
  handleLlmModal,
  handleSetupCommand,
} from "./connect.js";
import { checkTaskPreconditions, launchTask, truncate } from "./launch.js";
import { handleMemoryCommand, handleMemoryModal } from "./memory.js";
import { handleMemorySuggestionButton } from "./memorySuggestions.js";
import { handleOssCommand } from "./oss.js";
import { handleProposalButton } from "./proposals.js";
import { welcomeMessage } from "./welcome.js";
import { captureError } from "../observability.js";

export interface BotContext {
  db: Db;
  config: Config;
  github: GitHubService;
  orchestrator: TaskOrchestrator;
  /** Discord client; used by gates that need live guild data (trial gates). */
  client: Client;
}

export async function handleInteraction(
  ctx: BotContext,
  interaction: Interaction,
): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(ctx, interaction);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(ctx, interaction);
    } else if (interaction.isButton()) {
      await handleButton(ctx, interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(ctx, interaction);
    }
  } catch (err) {
    captureError(err, { msg: "interaction failed" });
    if (
      (interaction.isChatInputCommand() ||
        interaction.isButton() ||
        interaction.isModalSubmit()) &&
      !interaction.replied &&
      !interaction.deferred
    ) {
      await interaction
        .reply({
          content: "⚠️ Something went wrong handling that.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
}

async function handleCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "AnywhereCode only works inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  switch (interaction.commandName) {
    case "code":
      return startAgentTask(ctx, interaction, "code");
    case "ask":
      return startAgentTask(ctx, interaction, "ask");
    case "repo":
      return handleRepo(ctx, interaction);
    case "status":
      return handleStatus(ctx, interaction);
    case "cancel":
      return handleCancel(ctx, interaction);
    case "config":
      return handleConfig(ctx, interaction);
    case "connect":
      return handleConnectCommand(ctx, interaction);
    case "setup":
      return handleSetupCommand(ctx, interaction);
    case "billing":
      return handleBillingCommand(ctx, interaction);
    case "oss":
      return handleOssCommand(ctx, interaction);
    case "memory":
      return handleMemoryCommand(ctx, interaction);
  }
}

async function startAgentTask(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
  mode: "code" | "ask",
): Promise<void> {
  const guildId = interaction.guildId!;
  const prompt = interaction.options.getString(
    mode === "code" ? "task" : "question",
    true,
  );
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);

  const pre = await checkTaskPreconditions(
    ctx,
    guild,
    interaction.member,
    mode,
    { channelId: interaction.channelId },
    prompt,
  );
  if (!pre.ok) {
    await interaction.reply({
      content: pre.reason,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.channel?.isThread()) {
    await interaction.reply({
      content: "Run this in a regular text channel; I'll open a thread there.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const emoji = mode === "code" ? "🧵" : "💬";
  await interaction.reply(
    `${emoji} **${pre.repoFullName}** — ${truncate(prompt, 160)}`,
  );
  const reply = await interaction.fetchReply();
  await launchTask(ctx, {
    guildId,
    installationId: pre.installationId,
    repoFullName: pre.repoFullName,
    channelId: interaction.channelId,
    mode,
    prompt,
    requestedBy: interaction.user.username,
    thread: {
      kind: "create",
      client: interaction.client,
      channelId: interaction.channelId,
      anchorMessageId: reply.id,
      name: `${mode === "code" ? "code" : "ask"}: ${prompt}`,
    },
  });
}

const repoCache = new Map<number, { repos: string[]; fetchedAt: number }>();

async function handleAutocomplete(
  ctx: BotContext,
  interaction: AutocompleteInteraction,
): Promise<void> {
  if (interaction.commandName !== "repo") return;
  const guild = interaction.guildId
    ? await ctx.db.query.guilds.findFirst({
        where: eq(schema.guilds.id, interaction.guildId),
      })
    : undefined;
  if (!guild?.githubInstallationId) {
    await interaction.respond([]);
    return;
  }
  const cached = repoCache.get(guild.githubInstallationId);
  let repos: string[];
  if (cached && Date.now() - cached.fetchedAt < 60_000) {
    repos = cached.repos;
  } else {
    repos = await ctx.github.listRepos(guild.githubInstallationId);
    repoCache.set(guild.githubInstallationId, {
      repos,
      fetchedAt: Date.now(),
    });
  }
  const query = interaction.options.getFocused().toLowerCase();
  await interaction.respond(
    repos
      .filter((r) => r.toLowerCase().includes(query))
      .slice(0, 25)
      .map((r) => ({ name: r, value: r })),
  );
}

async function handleRepo(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  if (interaction.options.getSubcommand() === "show") {
    const row = await ctx.db.query.channelRepos.findFirst({
      where: eq(schema.channelRepos.channelId, interaction.channelId),
    });
    await interaction.reply({
      content: row
        ? `This channel works on **${row.repoFullName}**.`
        : "No repo set for this channel. Use `/repo set`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to change this channel's repo.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!guild.githubInstallationId) {
    const state = await createInstallState(
      ctx.db,
      ctx.config.STATE_SECRET,
      guildId,
      ctx.config.INSTALL_STATE_TTL_MINUTES,
    );
    await interaction.reply({
      content: `Connect GitHub first: [install the app](${ctx.github.installUrl(state)})`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const name = interaction.options.getString("name", true);
  const accessible = await ctx.github.listRepos(guild.githubInstallationId);
  if (!accessible.includes(name)) {
    await interaction.reply({
      content: `I don't have access to \`${name}\`. Grant it in the GitHub App settings, then retry.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await ctx.db
    .insert(schema.channelRepos)
    .values({ channelId: interaction.channelId, guildId, repoFullName: name })
    .onConflictDoUpdate({
      target: schema.channelRepos.channelId,
      set: { repoFullName: name, guildId },
    });
  await interaction.reply(`📌 This channel now works on **${name}**.`);
}

async function handleStatus(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const rows = await ctx.db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.guildId, interaction.guildId!),
      inArray(schema.tasks.status, ["queued", "running"]),
    ),
  });
  if (rows.length === 0) {
    await interaction.reply({
      content: "Nothing running. Start something with `/code`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const lines = rows.map(
    (t) =>
      `${t.status === "running" ? "🏃" : "⏳"} <#${t.threadId}> — \`${t.repoFullName}\`: ${truncate(t.prompt, 80)}`,
  );
  await interaction.reply({
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleCancel(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.channel?.isThread()) {
    await interaction.reply({
      content: "Run `/cancel` inside the task's thread.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const cancelled = await ctx.orchestrator.cancel(interaction.channel.id);
  await interaction.reply({
    content: cancelled
      ? "🛑 Cancelling…"
      : "No running task in this thread.",
    flags: cancelled ? undefined : MessageFlags.Ephemeral,
  });
}

async function handleConfig(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    await interaction.reply({
      content: "Only server admins can change configuration.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId!;
  await ensureGuild(ctx.db, guildId, ctx.config);
  const role = interaction.options.getRole("role");
  await ctx.db
    .update(schema.guilds)
    .set({ allowedRoleId: role?.id ?? null })
    .where(eq(schema.guilds.id, guildId));
  await interaction.reply(
    role
      ? `✅ Members with ${role.name} may now run agent tasks.`
      : "✅ Reset: only server admins may run agent tasks.",
  );
}

async function handleButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const [ns, action] = parts;
  if (ns !== "aw" || !action) return;

  // Route LLM buttons to connect handler (no taskId required)
  if (action === "llm") {
    const subAction = parts[2] ?? "";
    await handleLlmButton(ctx, interaction, subAction);
    return;
  }

  // Memory-suggestion cards carry their own row id
  if (action === "memsug") {
    const sub = parts[2];
    const suggestionId = parts[3];
    if ((sub !== "save" && sub !== "dismiss") || !suggestionId) return;
    await handleMemorySuggestionButton(ctx, interaction, sub, suggestionId);
    return;
  }

  // Proposal buttons carry a proposalId, not a taskId
  if (action === "proposal") {
    const sub = parts[2];
    const proposalId = parts[3];
    if ((sub !== "run" && sub !== "dismiss") || !proposalId) return;
    await handleProposalButton(ctx, interaction, sub, proposalId);
    return;
  }

  // Task action buttons (merge, iterate) require a taskId
  const taskId = parts[2];
  if (!taskId) return;

  const task = await ctx.db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task || !interaction.guildId || task.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "I can't find that task anymore.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guild = await ensureGuild(
    ctx.db,
    interaction.guildId,
    ctx.config,
  );

  // Spectate is open to any thread viewer (read-only) — gated by tier only.
  if (action === "spectate") {
    const tier = resolveTier(guild);
    if (tier.kind !== "paid") {
      await interaction.reply({
        content: "Spectate mode needs a Pro or Studio plan. See `/billing`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const enabled = ctx.orchestrator.enableSpectate(taskId);
    await interaction.reply({
      content: enabled
        ? "👁 Spectate on — verbose progress for everyone in this thread."
        : "This task isn't running anymore.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to do that.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "merge") {
    if (!task.prNumber || !guild.githubInstallationId) {
      await interaction.reply({
        content: "This task has no PR to merge.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    await ctx.github.mergePullRequest(
      guild.githubInstallationId,
      task.repoFullName,
      task.prNumber,
    );
    await interaction.editReply(
      `✅ Merged PR #${task.prNumber} (squash) — requested by ${interaction.user.username}.`,
    );
    return;
  }

  if (action === "iterate") {
    if (!task.prNumber || !guild.githubInstallationId) {
      await interaction.reply({
        content: "This task has no PR to iterate on.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!interaction.channel?.isThread()) {
      await interaction.reply({
        content: "Iterate only works from the task thread.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ctx.orchestrator.activeByThread(interaction.channel.id)) {
      await interaction.reply({
        content: "A task is already running in this thread.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const cap = capState(guild, "code");
    if (cap.exceeded) {
      await interaction.reply({
        content: `This server hit its monthly task limit (${cap.used}/${cap.cap}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const feedback = await ctx.github.pullRequestFeedback(
      guild.githubInstallationId,
      task.repoFullName,
      task.prNumber,
    );
    await interaction.reply(
      `🔁 Iterating on PR #${task.prNumber}${feedback.length ? ` with ${feedback.length} review note(s)` : ""}…`,
    );
    await launchTask(ctx, {
      guildId: interaction.guildId,
      installationId: guild.githubInstallationId,
      repoFullName: task.repoFullName,
      channelId: task.channelId,
      mode: "code",
      prompt: `Iterate on PR #${task.prNumber} (original task: ${task.prompt}). Address the review feedback and any new instructions from the thread.`,
      requestedBy: interaction.user.username,
      thread: { kind: "existing", thread: interaction.channel as ThreadChannel },
      iterate: {
        branch: task.branch,
        prNumber: task.prNumber,
        transcript: feedback,
      },
    });
  }
}

async function handleModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;
  const parts = interaction.customId.split(":");
  const [ns, type, providerType] = parts;
  if (ns !== "aw") return;
  if (type === "memory_modal") {
    await handleMemoryModal(ctx, interaction);
    return;
  }
  if (type !== "llm_modal" || !providerType) return;
  await handleLlmModal(ctx, interaction, providerType);
}

export { welcomeMessage };
