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
import { schema, type Db } from "@anywarecode/db";
import type { GitHubService } from "../github/app.js";
import { createInstallState } from "../github/install-state.js";
import { hasInstallation, listInstallations } from "../github/installations.js";
import { findPreviewUrl, prHeadSha } from "../github/preview.js";
import { applyPreviewToCard } from "./preview-card.js";
import type { TaskOrchestrator } from "../orchestrator/taskRunner.js";
import {
  canInvoke,
  capState,
  ensureGuild,
  planHasFeature,
} from "./gates.js";
import {
  handleBillingButton,
  handleBillingCommand,
  handleConnectCommand,
  handleLlmButton,
  handleLlmModal,
  handleSetupCommand,
} from "./connect.js";
import {
  checkSystemTaskPreconditions,
  checkTaskPreconditions,
  launchTask,
  truncate,
} from "./launch.js";
import { handleLinkCommand } from "./link.js";
import { handleMemoryCommand, handleMemoryModal } from "./memory.js";
import { handleMemorySuggestionButton } from "./memorySuggestions.js";
import { handleOssCommand } from "./oss.js";
import { handlePlanVoteButton, maybeRequirePlanVote } from "./plan-votes.js";
import { handleProposalButton, setProposalMessageId } from "./proposals.js";
import { handleReviewCommand } from "./review.js";
import { handleScheduleCommand } from "./schedule.js";
import { handleSquadButton, launchSquad, squadAllowed } from "./squad.js";
import { handleStandupCommand } from "../voice/standup.js";
import { postShipLog } from "./shiplog.js";
import { welcomeMessage } from "./welcome.js";
import { captureError } from "../observability.js";

export interface BotContext {
  db: Db;
  config: Config;
  github: GitHubService;
  orchestrator: TaskOrchestrator;
  /** Discord client; used by gates that need live guild data. */
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
      interaction.isChatInputCommand() ||
      interaction.isButton() ||
      interaction.isModalSubmit()
    ) {
      const content = "⚠️ Something went wrong handling that.";
      if (interaction.deferred && !interaction.replied) {
        // Already acked — edit the spinner so it doesn't hang.
        await interaction.editReply({ content }).catch(() => {});
      } else if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  }
}

async function handleCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({
      content: "AnyWareCode only works inside a server.",
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
    case "review":
      return handleReviewCommand(ctx, interaction);
    case "schedule":
      return handleScheduleCommand(ctx, interaction);
    case "standup":
      return handleStandupCommand(ctx, interaction);
    case "link":
      return handleLinkCommand(ctx, interaction);
  }
}

/** Per-user cooldown between task-launching commands (abuse/burst damping). */
const commandCooldown = new Map<string, number>();

async function startAgentTask(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
  mode: "code" | "ask",
): Promise<void> {
  const guildId = interaction.guildId!;
  const cooldownMs = ctx.config.COMMAND_COOLDOWN_SECONDS * 1000;
  if (cooldownMs > 0) {
    const key = `${guildId}:${interaction.user.id}`;
    const now = Date.now();
    const last = commandCooldown.get(key) ?? 0;
    if (now - last < cooldownMs) {
      await interaction.reply({
        content: "⏳ Slow down — wait a few seconds between tasks.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    commandCooldown.set(key, now);
  }
  // Ack within Discord's 3s window — the preconditions below hit a remote DB +
  // GitHub and can exceed it, which would invalidate the interaction (10062).
  await interaction.deferReply();
  const prompt = interaction.options.getString(
    mode === "code" ? "task" : "question",
    true,
  );
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  const planNow =
    mode === "code" && interaction.options.getBoolean("plan") === true;

  const pre = await checkTaskPreconditions(
    ctx,
    guild,
    interaction.member,
    mode,
    { channelId: interaction.channelId },
    prompt,
  );
  if (!pre.ok) {
    await interaction.editReply({ content: pre.reason });
    return;
  }
  if (interaction.channel?.isThread()) {
    await interaction.editReply({
      content: "Run this in a regular text channel; I'll open a thread there.",
    });
    return;
  }

  // Model selection is a paid perk; validate against the configured allowlist.
  let model: string | undefined;
  const requestedModel =
    mode === "code" ? interaction.options.getString("model") : null;
  if (requestedModel) {
    if (!(await planHasFeature(ctx.db, guild.planId, "model_select"))) {
      await interaction.editReply({
        content: "Model selection isn't enabled for this server's plan.",
      });
      return;
    }
    const allow = ctx.config.modelAllowlist;
    if (allow.length > 0 && !allow.includes(requestedModel)) {
      await interaction.editReply({
        content: `That model isn't available here. Allowed: ${allow.join(", ")}.`,
      });
      return;
    }
    model = requestedModel;
  }

  const squadN =
    mode === "code" && !planNow ? interaction.options.getInteger("squad") : null;
  if (squadN !== null && squadN !== undefined) {
    if (squadN > ctx.config.SQUAD_MAX || !(await squadAllowed(ctx, guild.planId))) {
      await interaction.editReply({
        content:
          squadN > ctx.config.SQUAD_MAX
            ? `Squads cap at ${ctx.config.SQUAD_MAX} attempts on this bot.`
            : "Squad Mode isn't enabled for this server's plan.",
      });
      return;
    }
  }

  if (mode === "code" && !planNow) {
    const decision = await maybeRequirePlanVote(ctx, {
      guild,
      authorId: interaction.user.id,
      repoFullName: pre.repoFullName,
      installationId: pre.installationId,
      channelId: interaction.channelId,
      prompt,
      // The squad marker survives into the proposal so approval re-launches
      // the full squad, not a single task (parsed in approvePlanProposal).
      summary: squadN
        ? `⚔️ Squad ×${squadN}: ${truncate(prompt.split("\n")[0] ?? prompt, 60)}`
        : truncate(prompt.split("\n")[0] ?? prompt, 80),
    });
    if (decision.kind === "vote") {
      await interaction.editReply({
        content: decision.card.content ?? "",
        components: decision.card.components ?? [],
        allowedMentions: { parse: [] },
      });
      const card = await interaction.fetchReply();
      await setProposalMessageId(ctx.db, decision.proposalId, card.id);
      return;
    }
  }

  if (squadN) {
    await interaction.editReply(
      `⚔️ **${pre.repoFullName}** — squad ×${squadN}: ${truncate(prompt, 140)}`,
    );
    const result = await launchSquad(ctx, {
      guildId,
      installationId: pre.installationId,
      repoFullName: pre.repoFullName,
      channelId: interaction.channelId,
      prompt,
      n: squadN,
      requestedBy: interaction.user.username,
      requestedById: interaction.user.id,
    });
    if (!result.ok) {
      await interaction.followUp({
        content: result.reason,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  const emoji = planNow ? "📋" : mode === "code" ? "🧵" : "💬";
  await interaction.editReply(
    `${emoji} **${pre.repoFullName}** — ${truncate(prompt, 160)}`,
  );
  const reply = await interaction.fetchReply();
  const namePrefix = planNow ? "plan" : mode === "code" ? "code" : "ask";
  await launchTask(ctx, {
    guildId,
    installationId: pre.installationId,
    repoFullName: pre.repoFullName,
    channelId: interaction.channelId,
    mode,
    prompt,
    requestedBy: interaction.user.username,
    requestedById: interaction.user.id,
    ...(model ? { model } : {}),
    ...(planNow ? { planMode: true } : {}),
    thread: {
      kind: "create",
      client: interaction.client,
      channelId: interaction.channelId,
      anchorMessageId: reply.id,
      name: `${namePrefix}: ${prompt}`,
    },
  });
}

const repoCache = new Map<number, { repos: string[]; fetchedAt: number }>();

async function handleAutocomplete(
  ctx: BotContext,
  interaction: AutocompleteInteraction,
): Promise<void> {
  // /repo set and /config issues both autocomplete repos, merged across
  // every linked installation (personal account + orgs).
  if (!["repo", "config"].includes(interaction.commandName)) return;
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const repos = await reposAcrossInstallations(ctx, interaction.guildId);
  const query = interaction.options.getFocused().toLowerCase();
  await interaction.respond(
    [...repos.keys()]
      .filter((r) => r.toLowerCase().includes(query))
      .slice(0, 25)
      .map((r) => ({ name: r, value: r })),
  );
}

/** repoFullName → owning installationId, merged over all linked installs.
 * First-linked installation wins a (rare) duplicate. Per-install 60s cache. */
async function reposAcrossInstallations(
  ctx: BotContext,
  guildId: string,
): Promise<Map<string, number>> {
  const merged = new Map<string, number>();
  for (const installation of await listInstallations(ctx.db, guildId)) {
    const cached = repoCache.get(installation.installationId);
    let repos: string[];
    if (cached && Date.now() - cached.fetchedAt < 60_000) {
      repos = cached.repos;
    } else {
      repos = await ctx.github
        .listRepos(installation.installationId)
        .catch(() => []);
      repoCache.set(installation.installationId, {
        repos,
        fetchedAt: Date.now(),
      });
    }
    for (const repo of repos) {
      if (!merged.has(repo)) merged.set(repo, installation.installationId);
    }
  }
  return merged;
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
  if (!(await hasInstallation(ctx.db, guildId))) {
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
  const accessible = await reposAcrossInstallations(ctx, guildId);
  const installationId = accessible.get(name);
  if (!installationId) {
    await interaction.reply({
      content: `I don't have access to \`${name}\` from any linked installation. Grant it in the GitHub App settings (or \`/connect github\` to add the org), then retry.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await ctx.db
    .insert(schema.channelRepos)
    .values({
      channelId: interaction.channelId,
      guildId,
      repoFullName: name,
      installationId,
    })
    .onConflictDoUpdate({
      target: schema.channelRepos.channelId,
      set: { repoFullName: name, guildId, installationId },
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
  const sub = interaction.options.getSubcommand();

  if (sub === "role") {
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
    return;
  }

  if (sub === "issues") {
    await handleConfigIssues(ctx, interaction);
    return;
  }

  if (sub === "sponsors") {
    const linked = interaction.options.getBoolean("linked", true);
    await ctx.db
      .update(schema.guilds)
      .set({ requireLinkedSponsor: linked })
      .where(eq(schema.guilds.id, guildId));
    await interaction.reply(
      linked
        ? "🧾 Code tasks now require the sponsoring member to have a linked GitHub identity (`/link github`)."
        : "✅ Sponsors no longer need a linked GitHub identity.",
    );
    return;
  }

  if (sub === "planvotes") {
    const mode = interaction.options.getString("mode", true) as
      | "instant"
      | "one_approval"
      | "role_gated";
    const role = interaction.options.getRole("role");
    await ctx.db
      .update(schema.guilds)
      .set({ planVoteMode: mode, planVoteRoleId: role?.id ?? null })
      .where(eq(schema.guilds.id, guildId));
    await interaction.reply(
      mode === "instant"
        ? "✅ Plan votes off — code tasks start immediately."
        : mode === "one_approval"
          ? "🗳️ Code tasks now post a plan card first; any authorized member's ✅ starts the run."
          : `🗳️ Code tasks now post a plan card first; approval needs ${role ? `the ${role.name} role` : "a server admin"}.`,
    );
    return;
  }

  if (sub === "review") {
    const repoFullName = interaction.options.getString("repo", true);
    const channel = interaction.options.getChannel("channel");
    if (channel) {
      const resolved = await interaction.client.channels
        .fetch(channel.id)
        .catch(() => null);
      if (!resolved?.isSendable()) {
        await interaction.reply({
          content: "I can't send messages in that channel — pick one where I have Send Messages.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
    await ctx.db
      .insert(schema.repoSettings)
      .values({
        guildId,
        repoFullName,
        autoReview: Boolean(channel),
        reviewChannelId: channel?.id ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.repoSettings.guildId, schema.repoSettings.repoFullName],
        set: { autoReview: Boolean(channel), reviewChannelId: channel?.id ?? null },
      });
    await interaction.reply(
      channel
        ? `🔎 Every opened PR on \`${repoFullName}\` will be auto-reviewed into <#${channel.id}> (counts against the /ask quota).`
        : `✅ Auto-review for \`${repoFullName}\` turned off.`,
    );
    return;
  }

  if (sub === "shiplog") {
    const channel = interaction.options.getChannel("channel");
    if (channel) {
      const resolved = await interaction.client.channels
        .fetch(channel.id)
        .catch(() => null);
      if (!resolved?.isSendable()) {
        await interaction.reply({
          content: "I can't send messages in that channel — pick one where I have Send Messages.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
    await ctx.db
      .update(schema.guilds)
      .set({ shiplogChannelId: channel?.id ?? null })
      .where(eq(schema.guilds.id, guildId));
    await interaction.reply(
      channel
        ? `🚢 Merged agent PRs will be announced in <#${channel.id}>.`
        : "✅ Ship log turned off.",
    );
    return;
  }
}

async function handleConfigIssues(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const repoFullName = interaction.options.getString("repo", true);
  const channel = interaction.options.getChannel("channel");
  const labels = (interaction.options.getString("labels") ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const trust = (interaction.options.getString("trust") ?? "any") as
    | "any"
    | "contributor"
    | "member"
    | "owner";
  const dailyCap = interaction.options.getInteger("daily_cap") ?? 10;
  const repro = interaction.options.getBoolean("repro") ?? false;

  if (!channel) {
    await ctx.db
      .update(schema.repoSettings)
      .set({ issueChannelId: null })
      .where(
        and(
          eq(schema.repoSettings.guildId, guildId),
          eq(schema.repoSettings.repoFullName, repoFullName),
        ),
      );
    await interaction.reply(`✅ Issue feed for \`${repoFullName}\` turned off.`);
    return;
  }

  // Validate the bot can actually post there before saving.
  const resolved = await interaction.client.channels
    .fetch(channel.id)
    .catch(() => null);
  if (!resolved?.isSendable()) {
    await interaction.reply({
      content: "I can't send messages in that channel — pick one where I have Send Messages.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ctx.db
    .insert(schema.repoSettings)
    .values({
      guildId,
      repoFullName,
      issueChannelId: channel.id,
      issueLabels: labels,
      issueMinAssoc: trust,
      issueDailyCap: dailyCap,
      reproGate: repro,
      failCount: 0,
    })
    .onConflictDoUpdate({
      target: [schema.repoSettings.guildId, schema.repoSettings.repoFullName],
      set: {
        issueChannelId: channel.id,
        issueLabels: labels,
        issueMinAssoc: trust,
        issueDailyCap: dailyCap,
        reproGate: repro,
        failCount: 0,
      },
    });
  await interaction.reply(
    `🐛 New issues in \`${repoFullName}\`${labels.length ? ` labeled ${labels.map((l) => `\`${l}\``).join("/")}` : ""} will appear in <#${channel.id}> as Run/Dismiss cards (max ${dailyCap}/day, author trust: ${trust}).${
      repro
        ? " 🔬 Repro Gate on — each report gets verified in the sandbox first (uses /ask quota; unlimited on the OSS tier)."
        : ""
    }`,
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

  // Squad vote cards carry a squadId (+ attempt index for Ship)
  if (action === "squad") {
    const sub = parts[2];
    const squadId = parts[3];
    if ((sub !== "ship" && sub !== "scrap") || !squadId) return;
    const idx = sub === "ship" ? Number.parseInt(parts[4] ?? "", 10) : null;
    if (sub === "ship" && (idx === null || Number.isNaN(idx))) return;
    await handleSquadButton(ctx, interaction, sub, squadId, idx);
    return;
  }

  // Plan-vote cards carry a proposalId
  if (action === "planvote") {
    const sub = parts[2];
    const proposalId = parts[3];
    if ((sub !== "approve" && sub !== "reject") || !proposalId) return;
    await handlePlanVoteButton(ctx, interaction, sub, proposalId);
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

  // Billing buttons (Job Pack / Cancel) — no taskId; bridge to the web.
  if (action === "billing") {
    const sub = parts[2];
    if (sub !== "pack" && sub !== "cancel") return;
    await handleBillingButton(ctx, interaction, sub);
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
    const enabled = ctx.orchestrator.enableSpectate(taskId);
    await interaction.reply({
      content: enabled
        ? "👁 Spectate on — verbose progress for everyone in this thread."
        : "This task isn't running anymore.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Preview is read-only — any member may resolve it; no canInvoke gate.
  if (action === "preview") {
    if (!task.prNumber || !task.installationId) {
      await interaction.reply({
        content: "This task has no PR to preview.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sha = await prHeadSha(
      ctx.github,
      task.installationId,
      task.repoFullName,
      task.prNumber,
    );
    const url = sha
      ? await findPreviewUrl(
          ctx.github,
          task.installationId,
          task.repoFullName,
          sha,
        )
      : null;
    if (!url) {
      await interaction.editReply(
        "No preview deployment found yet — if your CI publishes one (Vercel/Netlify/Pages), try again once it finishes.",
      );
      return;
    }
    await applyPreviewToCard({ db: ctx.db, client: interaction.client }, task, url);
    await interaction.editReply(`🔍 Preview: ${url}`);
    return;
  }

  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to do that.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "plandismiss") {
    ctx.orchestrator.takePendingPlan(taskId);
    await interaction
      .update({ content: "Plan dismissed.", embeds: [], components: [] })
      .catch(() => {});
    return;
  }

  if (action === "planimpl") {
    const pending = ctx.orchestrator.peekPendingPlan(taskId);
    if (!pending) {
      await interaction.reply({
        content: "This plan expired or was already implemented.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // Re-check cap/suspension/LLM since the plan was proposed (state can change).
    const pre = await checkSystemTaskPreconditions(
      ctx,
      guild,
      "code",
      { repoFullName: pending.repoFullName, installationId: pending.installationId },
      pending.prompt,
    );
    if (!pre.ok) {
      await interaction.reply({ content: pre.reason, flags: MessageFlags.Ephemeral });
      return;
    }
    ctx.orchestrator.takePendingPlan(taskId); // consume now that it will run
    const thread = interaction.channel?.isThread()
      ? (interaction.channel as ThreadChannel)
      : ((await interaction.client.channels
          .fetch(pending.threadId)
          .catch(() => null)) as ThreadChannel | null);
    if (!thread) {
      await interaction.reply({
        content: "Couldn't find the thread to implement the plan in.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({ components: [] }).catch(() => {});
    await thread.send(
      `🧵 Implementing the approved plan — requested by ${interaction.user.username}.`,
    );
    await launchTask(ctx, {
      guildId: pending.guildId,
      installationId: pending.installationId,
      repoFullName: pending.repoFullName,
      channelId: pending.channelId,
      mode: "code",
      prompt: pending.prompt,
      requestedBy: interaction.user.username,
      requestedById: interaction.user.id,
      planApprovedBy: interaction.user.username,
      ...(pending.model ? { model: pending.model } : {}),
      transcript: [{ author: "plan", text: pending.planText }],
      thread: { kind: "existing", thread },
    });
    return;
  }

  if (action === "merge") {
    if (!task.prNumber || !task.installationId) {
      await interaction.reply({
        content: "This task has no PR to merge.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    await ctx.github.mergePullRequest(
      task.installationId,
      task.repoFullName,
      task.prNumber,
    );
    await interaction.editReply(
      `✅ Merged PR #${task.prNumber} (squash) — requested by ${interaction.user.username}.`,
    );
    void postShipLog(
      { db: ctx.db, client: interaction.client },
      task,
      interaction.user.username,
    ).catch((err) => captureError(err, { msg: "ship log (merge button) failed" }));
    return;
  }

  if (action === "iterate") {
    if (!task.prNumber || !task.installationId) {
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
      task.installationId,
      task.repoFullName,
      task.prNumber,
    );
    await interaction.reply(
      `🔁 Iterating on PR #${task.prNumber}${feedback.length ? ` with ${feedback.length} review note(s)` : ""}…`,
    );
    await launchTask(ctx, {
      guildId: interaction.guildId,
      installationId: task.installationId,
      repoFullName: task.repoFullName,
      channelId: task.channelId,
      mode: "code",
      prompt: `Iterate on PR #${task.prNumber} (original task: ${task.prompt}). Address the review feedback and any new instructions from the thread.`,
      requestedBy: interaction.user.username,
    requestedById: interaction.user.id,
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
