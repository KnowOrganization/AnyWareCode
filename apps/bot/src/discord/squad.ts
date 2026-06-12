import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getPlan, schema, type Squad, type Task } from "@anywherecode/db";
import { captureError, log } from "../observability.js";
import { claimUnits } from "../orchestrator/usage.js";
import { canInvoke, ensureGuild, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { launchTask, truncate } from "./launch.js";
import { prCardButtons } from "./preview-card.js";
import { provenanceReceipt } from "../orchestrator/taskRunner.js";

/**
 * Squad Mode: N parallel attempts in separate sandboxes, results as
 * side-by-side cards, the server picks the winner. Burning N units is the
 * point (task packs exist for this). Everything the vote card needs lives in
 * the DB (squads row + tasks rows with diffSummary), so a restart mid-squad
 * is recoverable by the sweep.
 */

const LETTERS = ["A", "B", "C", "D", "E"] as const;
const REGIONALS = ["🇦", "🇧", "🇨", "🇩", "🇪"] as const;

export async function squadAllowed(
  ctx: Pick<BotContext, "db">,
  guildId: string,
  guildPlanId: string | null,
  tierKind: string,
): Promise<boolean> {
  const planId =
    tierKind === "oss" ? "oss" : tierKind === "paid" ? guildPlanId : null;
  const plan = planId ? await getPlan(ctx.db, planId) : null;
  return Boolean(plan?.features.includes("squad_mode"));
}

export interface SquadLaunchArgs {
  guildId: string;
  installationId: number;
  repoFullName: string;
  channelId: string;
  prompt: string;
  n: number;
  requestedBy: string;
  requestedById: string;
  planApprovedBy?: string;
}

export async function launchSquad(
  ctx: BotContext,
  args: SquadLaunchArgs,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const funded = await claimUnits(ctx.db, args.guildId, args.n);
  if (!funded) {
    return {
      ok: false,
      reason: `A squad of ${args.n} needs ${args.n} task units and this server doesn't have them${
        ctx.config.WEB_URL
          ? ` — any member can add a pack at ${ctx.config.WEB_URL}/packs/${args.guildId}`
          : ""
      }.`,
    };
  }

  const channel = await ctx.client.channels
    .fetch(args.channelId)
    .catch(() => null);
  if (!channel?.isSendable()) {
    return { ok: false, reason: "I can't post in this channel." };
  }

  const squadId = randomUUID().slice(0, 8);
  const attemptTaskIds = Array.from({ length: args.n }, () =>
    randomUUID().slice(0, 8),
  );
  await ctx.db.insert(schema.squads).values({
    id: squadId,
    guildId: args.guildId,
    channelId: args.channelId,
    repoFullName: args.repoFullName,
    prompt: args.prompt,
    requestedBy: args.requestedBy,
    attemptTaskIds,
    expiresAt: new Date(
      Date.now() + ctx.config.SQUAD_VOTE_TTL_HOURS * 3_600_000,
    ),
  });

  // One anchor message per attempt — Discord allows one thread per message.
  const outcomes = attemptTaskIds.map(async (taskId, i) => {
    const anchor = await channel.send({
      content: `⚔️ **Squad attempt ${LETTERS[i]}** — ${truncate(args.prompt, 150)}`,
      allowedMentions: { parse: [] },
    });
    const { outcome } = await launchTask(ctx, {
      guildId: args.guildId,
      installationId: args.installationId,
      repoFullName: args.repoFullName,
      channelId: args.channelId,
      mode: "code",
      prompt: args.prompt,
      requestedBy: args.requestedBy,
      requestedById: args.requestedById,
      ...(args.planApprovedBy ? { planApprovedBy: args.planApprovedBy } : {}),
      taskId,
      deferPr: true,
      prefundedBy: funded[i] ?? "plan",
      thread: {
        kind: "create",
        client: ctx.client,
        channelId: args.channelId,
        anchorMessageId: anchor.id,
        name: `squad ${LETTERS[i]}: ${args.prompt}`,
      },
    });
    return outcome;
  });

  // Coordinator: when every attempt settles, open the vote. A crash here is
  // fine — the sweep rebuilds the card from the DB.
  void Promise.all(
    outcomes.map((p) => p.then((o) => o).catch(() => null)),
  ).then(async () => {
    await finalizeSquad(ctx, squadId).catch((err) =>
      captureError(err, { msg: "squad finalize failed", squadId }),
    );
  });
  return { ok: true };
}

/** running → voting (post the card) or failed; idempotent via status claim. */
async function finalizeSquad(ctx: BotContext, squadId: string): Promise<void> {
  const squad = await ctx.db.query.squads.findFirst({
    where: eq(schema.squads.id, squadId),
  });
  if (!squad || squad.status !== "running") return;
  const attempts = await attemptRows(ctx, squad);
  const pushed = attempts.filter((t) => t?.status === "done" && t.diffSummary);

  if (pushed.length === 0) {
    await ctx.db
      .update(schema.squads)
      .set({ status: "failed" })
      .where(and(eq(schema.squads.id, squadId), eq(schema.squads.status, "running")));
    const channel = await ctx.client.channels
      .fetch(squad.channelId)
      .catch(() => null);
    if (channel?.isSendable()) {
      await channel
        .send({
          content: `⚔️ Squad finished with no shippable attempts — failed attempts were refunded.`,
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    }
    return;
  }

  const claimed = await ctx.db
    .update(schema.squads)
    .set({ status: "voting" })
    .where(and(eq(schema.squads.id, squadId), eq(schema.squads.status, "running")))
    .returning();
  if (claimed.length === 0) return;

  const channel = await ctx.client.channels
    .fetch(squad.channelId)
    .catch(() => null);
  if (!channel?.isSendable()) return;
  const card = await channel.send(voteCard(squad, attempts));
  await ctx.db
    .update(schema.squads)
    .set({ voteMessageId: card.id })
    .where(eq(schema.squads.id, squadId));
  for (let i = 0; i < squad.attemptTaskIds.length; i++) {
    if (attempts[i]?.status === "done" && attempts[i]?.diffSummary) {
      await card.react(REGIONALS[i] ?? "✅").catch(() => {});
    }
  }
}

async function attemptRows(
  ctx: BotContext,
  squad: Squad,
): Promise<Array<Task | undefined>> {
  const rows = await ctx.db.query.tasks.findMany({
    where: inArray(schema.tasks.id, squad.attemptTaskIds),
  });
  return squad.attemptTaskIds.map((id) => rows.find((r) => r.id === id));
}

function voteCard(squad: Squad, attempts: Array<Task | undefined>) {
  const lines: string[] = [
    `⚔️ **Squad results** — ${truncate(squad.prompt, 120)}`,
    "Pick the winner; losing branches are discarded.",
  ];
  const buttons: ButtonBuilder[] = [];
  attempts.forEach((task, i) => {
    const letter = LETTERS[i] ?? "?";
    if (!task || task.status !== "done" || !task.diffSummary) {
      lines.push(`${REGIONALS[i]} **${letter}** — no shippable result`);
      return;
    }
    const files = task.diffSummary;
    const add = files.reduce((n, f) => n + f.additions, 0);
    const del = files.reduce((n, f) => n + f.deletions, 0);
    lines.push(
      `${REGIONALS[i]} **${letter}** — ${files.length} file(s), +${add} −${del} · <#${task.threadId}>`,
    );
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`aw:squad:ship:${squad.id}:${i}`)
        .setLabel(`Ship ${letter}`)
        .setStyle(ButtonStyle.Success),
    );
  });
  lines.push("React to vote — any authorized member ships the winner.");
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`aw:squad:scrap:${squad.id}`)
      .setLabel("Scrap all")
      .setStyle(ButtonStyle.Danger),
  );
  return {
    content: lines.join("\n"),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)],
    allowedMentions: { parse: [] as const },
  };
}

export async function handleSquadButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
  sub: "ship" | "scrap",
  squadId: string,
  attemptIdx: number | null,
): Promise<void> {
  if (!interaction.guildId) return;
  const squad = await ctx.db.query.squads.findFirst({
    where: eq(schema.squads.id, squadId),
  });
  if (!squad || squad.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "I can't find that squad anymore.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guild = await ensureGuild(ctx.db, interaction.guildId, ctx.config);
  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to decide squad outcomes here.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!guild.githubInstallationId) {
    await interaction.reply({
      content: "GitHub isn't connected anymore.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "scrap") {
    const claimed = await ctx.db
      .update(schema.squads)
      .set({ status: "expired" })
      .where(and(eq(schema.squads.id, squadId), eq(schema.squads.status, "voting")))
      .returning();
    if (claimed.length === 0) {
      await interaction.reply({
        content: "Someone already decided this squad.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      content: `⚔️ ~~${truncate(squad.prompt, 100)}~~ — scrapped by ${interaction.user.username}; all branches deleted.`,
      components: [],
    });
    await deleteSquadBranches(ctx, squad, guild.githubInstallationId, null);
    return;
  }

  // ship
  const attempts = await attemptRows(ctx, squad);
  const winner = attemptIdx !== null ? attempts[attemptIdx] : undefined;
  if (!winner || winner.status !== "done") {
    await interaction.reply({
      content: "That attempt has no shippable result.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const claimed = await ctx.db
    .update(schema.squads)
    .set({ status: "shipped", winnerTaskId: winner.id })
    .where(and(eq(schema.squads.id, squadId), eq(schema.squads.status, "voting")))
    .returning();
  if (claimed.length === 0) {
    await interaction.reply({
      content: "Someone already decided this squad.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();

  const votes = await readVoteCounts(interaction.message, attempts.length);
  const pr = await ctx.github.createPullRequest({
    installationId: guild.githubInstallationId,
    repoFullName: squad.repoFullName,
    branch: winner.branch,
    baseBranch: winner.baseBranch,
    title: squad.prompt.split("\n")[0]?.slice(0, 72) ?? winner.branch,
    body: `${squad.prompt}\n\n${provenanceReceipt({
      initiatedBy: `discord:${squad.requestedBy}`,
      planApprovedBy: null,
      steeredBy: [],
      testResults: [],
      diffFiles: winner.diffSummary ?? [],
      threadUrl: `https://discord.com/channels/${squad.guildId}/${winner.threadId}`,
    })}\n\nSquad winner ${LETTERS[attemptIdx ?? 0]} of ${squad.attemptTaskIds.length}, shipped by discord:${interaction.user.username}${
      votes ? ` (votes: ${votes})` : ""
    }.`,
  });
  const prUrl = `https://github.com/${squad.repoFullName}/pull/${pr.number}`;

  // PR card lands in the winner's thread with the normal buttons.
  const thread = await ctx.client.channels
    .fetch(winner.threadId)
    .catch(() => null);
  let prMessageId: string | null = null;
  if (thread?.isThread()) {
    const prCard = await thread
      .send({
        content: `🔀 **PR #${pr.number} ready** — squad winner ${LETTERS[attemptIdx ?? 0]}: ${prUrl}`,
        components: [prCardButtons(winner.id, prUrl, null)],
      })
      .catch(() => null);
    prMessageId = prCard?.id ?? null;
  }
  await ctx.db
    .update(schema.tasks)
    .set({ prNumber: pr.number, ...(prMessageId ? { prMessageId } : {}) })
    .where(eq(schema.tasks.id, winner.id));

  await interaction
    .editReply({
      content: `⚔️ **Squad shipped** — ${LETTERS[attemptIdx ?? 0]} won${votes ? ` (votes: ${votes})` : ""}, PR #${pr.number} by ${interaction.user.username}. Losing branches deleted.\n${prUrl}`,
      components: [],
    })
    .catch(() => {});
  await deleteSquadBranches(ctx, squad, guild.githubInstallationId, winner.id);
}

async function readVoteCounts(
  message: Message,
  attemptCount: number,
): Promise<string | null> {
  try {
    const counts: string[] = [];
    for (let i = 0; i < attemptCount; i++) {
      const emoji = REGIONALS[i];
      if (!emoji) continue;
      const reaction = message.reactions.cache.get(emoji);
      // Subtract the bot's own seed reaction.
      const n = Math.max(0, (reaction?.count ?? 0) - 1);
      counts.push(`${emoji} ${n}`);
    }
    return counts.length > 0 ? counts.join(" · ") : null;
  } catch {
    return null;
  }
}

async function deleteSquadBranches(
  ctx: BotContext,
  squad: Squad,
  installationId: number,
  keepTaskId: string | null,
): Promise<void> {
  const attempts = await attemptRows(ctx, squad);
  for (const task of attempts) {
    if (!task || task.id === keepTaskId || task.status !== "done") continue;
    await ctx.github
      .deleteRef(installationId, squad.repoFullName, task.branch)
      .catch(() => {}); // best-effort: branch may be gone already
  }
}

/**
 * Restart/expiry safety. Boot: recovery has already failed any in-flight
 * attempts, so a `running` squad whose attempts are all terminal finalizes
 * from the DB. Interval: expired `voting` squads get their buttons retired
 * and branches cleaned up.
 */
export async function sweepSquads(ctx: BotContext): Promise<void> {
  const running = await ctx.db.query.squads.findMany({
    where: eq(schema.squads.status, "running"),
  });
  for (const squad of running) {
    const attempts = await attemptRows(ctx, squad);
    const allTerminal = attempts.every(
      (t) => !t || ["done", "failed", "cancelled"].includes(t.status),
    );
    if (allTerminal) {
      await finalizeSquad(ctx, squad.id).catch((err) =>
        captureError(err, { msg: "squad sweep finalize failed", squadId: squad.id }),
      );
    }
  }

  const expired = await ctx.db.query.squads.findMany({
    where: and(
      eq(schema.squads.status, "voting"),
      lt(schema.squads.expiresAt, new Date()),
    ),
  });
  for (const squad of expired) {
    const claimed = await ctx.db
      .update(schema.squads)
      .set({ status: "expired" })
      .where(and(eq(schema.squads.id, squad.id), eq(schema.squads.status, "voting")))
      .returning();
    if (claimed.length === 0) continue;
    const guild = await ctx.db.query.guilds.findFirst({
      where: eq(schema.guilds.id, squad.guildId),
    });
    if (guild?.githubInstallationId) {
      await deleteSquadBranches(ctx, squad, guild.githubInstallationId, null);
    }
    if (squad.voteMessageId) {
      const channel = await ctx.client.channels
        .fetch(squad.channelId)
        .catch(() => null);
      if (channel?.isSendable()) {
        const msg = await channel.messages
          .fetch(squad.voteMessageId)
          .catch(() => null);
        await msg
          ?.edit({
            content: `⚔️ ~~${truncate(squad.prompt, 100)}~~ — squad vote expired; branches deleted.`,
            components: [],
          })
          .catch(() => {});
      }
    }
    log.info({ squadId: squad.id }, "squad expired");
  }
}

export function startSquadSweeper(ctx: BotContext): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepSquads(ctx).catch((err) =>
      captureError(err, { msg: "squad sweep failed" }),
    );
  }, 5 * 60_000);
  timer.unref();
  return timer;
}
