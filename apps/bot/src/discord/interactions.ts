import {
  ChannelType,
  GuildMember,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ThreadChannel,
} from "discord.js";
import { and, eq, inArray } from "drizzle-orm";
import type { Config } from "../config.js";
import { schema, type Db } from "../db/index.js";
import type { Guild } from "../db/schema.js";
import type { GitHubService } from "../github/app.js";
import { createInstallState } from "../github/install-state.js";
import type { TaskOrchestrator } from "../orchestrator/taskRunner.js";
import { canInvoke, capState, ensureGuild } from "./gates.js";
import { welcomeMessage } from "./welcome.js";

export interface BotContext {
  db: Db;
  config: Config;
  github: GitHubService;
  orchestrator: TaskOrchestrator;
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
    }
  } catch (err) {
    console.error("interaction failed", err);
    if (
      (interaction.isChatInputCommand() || interaction.isButton()) &&
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
  const guild = await ensureGuild(ctx.db, guildId, ctx.config.DEFAULT_TASK_CAP);

  const refusal = await checkPreconditions(ctx, interaction, guild, mode);
  if (refusal) {
    await interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral });
    return;
  }
  const channelRepo = await ctx.db.query.channelRepos.findFirst({
    where: eq(schema.channelRepos.channelId, interaction.channelId),
  });
  if (!channelRepo) {
    await interaction.reply({
      content: "No repo set for this channel yet — run `/repo set` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    !interaction.channel ||
    interaction.channel.type !== ChannelType.GuildText
  ) {
    await interaction.reply({
      content: "Run this in a regular text channel; I'll open a thread there.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const emoji = mode === "code" ? "🧵" : "💬";
  await interaction.reply(
    `${emoji} **${channelRepo.repoFullName}** — ${truncate(prompt, 160)}`,
  );
  const reply = await interaction.fetchReply();
  const thread = await reply.startThread({
    name: truncate(`${mode === "code" ? "code" : "ask"}: ${prompt}`, 90),
    autoArchiveDuration: 1440,
  });

  await bumpUsage(ctx.db, guildId, mode);
  void ctx.orchestrator
    .run({
      guildId,
      installationId: guild.githubInstallationId!,
      channelId: interaction.channelId,
      thread,
      repoFullName: channelRepo.repoFullName,
      prompt,
      requestedBy: interaction.user.username,
      mode,
    })
    .catch(async (err: unknown) => {
      console.error(`task in thread ${thread.id} failed`, err);
      await thread
        .send("⚠️ The task crashed before finishing. Check the bot logs.")
        .catch(() => {});
    });
}

async function checkPreconditions(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  mode: "code" | "ask",
): Promise<string | null> {
  if (!(interaction.member instanceof GuildMember)) {
    return "Couldn't resolve your server membership; try again.";
  }
  if (!canInvoke(guild, interaction.member)) {
    return "You don't have permission to run agent tasks here. Ask an admin to grant your role with `/config role`.";
  }
  if (!guild.githubInstallationId) {
    const state = await createInstallState(
      ctx.db,
      ctx.config.STATE_SECRET,
      guild.id,
      ctx.config.INSTALL_STATE_TTL_MINUTES,
    );
    return `GitHub isn't connected yet. An admin needs to [install the GitHub App](${ctx.github.installUrl(state)}).`;
  }
  const cap = capState(guild, mode);
  if (cap.exceeded) {
    return `This server hit its monthly ${mode === "code" ? "task" : "question"} limit (${cap.used}/${cap.cap}). Resets ${guild.capResetAt.toDateString()}.`;
  }
  return null;
}

async function bumpUsage(
  db: Db,
  guildId: string,
  mode: "code" | "ask",
): Promise<void> {
  const guild = await db.query.guilds.findFirst({
    where: eq(schema.guilds.id, guildId),
  });
  if (!guild) return;
  await db
    .update(schema.guilds)
    .set(
      mode === "code"
        ? { tasksUsedThisMonth: guild.tasksUsedThisMonth + 1 }
        : { asksUsedThisMonth: guild.asksUsedThisMonth + 1 },
    )
    .where(eq(schema.guilds.id, guildId));
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

  const guild = await ensureGuild(ctx.db, guildId, ctx.config.DEFAULT_TASK_CAP);
  if (!(interaction.member instanceof GuildMember) || !canInvoke(guild, interaction.member)) {
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
  if (
    !(interaction.member instanceof GuildMember) ||
    !interaction.member.permissions.has("ManageGuild")
  ) {
    await interaction.reply({
      content: "Only server admins can change configuration.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId!;
  await ensureGuild(ctx.db, guildId, ctx.config.DEFAULT_TASK_CAP);
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
  const [ns, action, taskId] = interaction.customId.split(":");
  if (ns !== "aw" || !taskId) return;
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
    ctx.config.DEFAULT_TASK_CAP,
  );
  if (
    !(interaction.member instanceof GuildMember) ||
    !canInvoke(guild, interaction.member)
  ) {
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
    await bumpUsage(ctx.db, interaction.guildId, "code");
    const thread = interaction.channel as ThreadChannel;
    void ctx.orchestrator
      .run({
        guildId: interaction.guildId,
        installationId: guild.githubInstallationId,
        channelId: task.channelId,
        thread,
        repoFullName: task.repoFullName,
        prompt: `Iterate on PR #${task.prNumber} (original task: ${task.prompt}). Address the review feedback and any new instructions from the thread.`,
        requestedBy: interaction.user.username,
        mode: "code",
        iterate: {
          branch: task.branch,
          prNumber: task.prNumber,
          transcript: feedback,
        },
      })
      .catch(async (err: unknown) => {
        console.error(`iterate in thread ${thread.id} failed`, err);
        await thread.send("⚠️ Iteration crashed before finishing.").catch(() => {});
      });
  }
}

export { welcomeMessage };

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
