import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type APIInteractionGuildMember,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type MessageCreateOptions,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { schema, type Guild, type Proposal } from "@anywherecode/db";
import { resolveLlmAuth } from "../llm/credentials.js";
import { generatePlan } from "../llm/plan.js";
import { canInvoke, ensureGuild } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { launchTask, truncate } from "./launch.js";
import { createProposal, setProposalMessageId } from "./proposals.js";

/**
 * Plan votes: before burning a code task, the agent's plan goes up as a card
 * the team approves — ✅ reaction or Approve button. Generation is one cheap
 * bot-side call (no container is held while voting; that's the cost votes
 * exist to prevent). Quota bumps only at launch, which is already true of the
 * proposal flow this rides on.
 */

export type PlanVoteDecision =
  | { kind: "launch" }
  | { kind: "vote"; proposalId: string; card: MessageCreateOptions };

export async function maybeRequirePlanVote(
  ctx: BotContext,
  args: {
    guild: Guild;
    authorId: string;
    repoFullName: string;
    channelId: string;
    prompt: string;
    summary: string;
  },
): Promise<PlanVoteDecision> {
  if (args.guild.planVoteMode === "instant") return { kind: "launch" };

  const resolved = await resolveLlmAuth(ctx.db, ctx.config, args.guild.id);
  const plan = resolved.auth
    ? await generatePlan(resolved.auth, ctx.config.CHAT_MODEL, args.prompt)
    : { steps: ["Plan unavailable — vote on the task description above."], risks: null };

  const planText = [
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(plan.risks ? [`⚠️ ${plan.risks}`] : []),
  ].join("\n");

  const { id } = await createProposal(ctx, {
    guildId: args.guild.id,
    channelId: args.channelId,
    threadId: null,
    authorId: args.authorId,
    prompt: args.prompt,
    summary: args.summary,
    repoFullName: args.repoFullName,
    source: "plan",
    planText,
    ttlMs: ctx.config.PLAN_VOTE_TTL_MINUTES * 60_000,
  });

  const gateLabel =
    args.guild.planVoteMode === "role_gated"
      ? args.guild.planVoteRoleId
        ? `<@&${args.guild.planVoteRoleId}> approval`
        : "admin approval"
      : "one approval";
  return {
    kind: "vote",
    proposalId: id,
    card: {
      content: [
        `🗳️ **Plan vote** — ${truncate(args.summary, 100)}`,
        `> ${truncate(args.prompt, 200)}`,
        planText,
        `React ✅ or hit Approve to start (needs ${gateLabel}).`,
      ].join("\n"),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`aw:planvote:approve:${id}`)
            .setLabel("Approve & run")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`aw:planvote:reject:${id}`)
            .setLabel("Reject")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
      allowedMentions: { parse: [] },
    },
  };
}

/** Whether this member may approve a plan vote under the guild's mode. */
export function canApprovePlan(
  guild: Guild,
  member: GuildMember | APIInteractionGuildMember,
): boolean {
  if (guild.planVoteMode === "role_gated") {
    const roles = Array.isArray(member.roles)
      ? member.roles
      : [...member.roles.cache.keys()];
    if (guild.planVoteRoleId && roles.includes(guild.planVoteRoleId)) return true;
    const perms =
      typeof member.permissions === "string"
        ? BigInt(member.permissions) & PermissionFlagsBits.ManageGuild
        : member.permissions.has(PermissionFlagsBits.ManageGuild);
    return Boolean(perms);
  }
  // one_approval: anyone who could have launched the task — requester included;
  // the pause + team visibility is the feature, not requester exclusion.
  return canInvoke(guild, member);
}

/**
 * Shared approval path for the button and the ✅ reaction. Atomically claims
 * the proposal (double-approve safe) and launches with the card as anchor.
 */
export async function approvePlanProposal(
  ctx: BotContext,
  proposal: Proposal,
  approver: { id: string; username: string },
  client: Client,
): Promise<{ ok: boolean; reason?: string }> {
  if (proposal.status !== "pending" || proposal.expiresAt < new Date()) {
    return { ok: false, reason: "This plan vote has expired." };
  }
  const claimed = await ctx.db
    .update(schema.proposals)
    .set({ status: "accepted" })
    .where(
      and(
        eq(schema.proposals.id, proposal.id),
        eq(schema.proposals.status, "pending"),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    return { ok: false, reason: "Someone already acted on this plan." };
  }
  const guild = await ensureGuild(ctx.db, proposal.guildId, ctx.config);
  if (!guild.githubInstallationId || !proposal.messageId) {
    return { ok: false, reason: "This plan can't launch anymore (setup changed)." };
  }
  await launchTask(ctx, {
    guildId: proposal.guildId,
    installationId: guild.githubInstallationId,
    repoFullName: proposal.repoFullName,
    channelId: proposal.channelId,
    mode: "code",
    prompt: proposal.prompt,
    requestedBy: approver.username,
    thread: {
      kind: "create",
      client,
      channelId: proposal.channelId,
      anchorMessageId: proposal.messageId,
      name: `code: ${proposal.summary}`,
    },
  });
  return { ok: true };
}

export async function handlePlanVoteButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
  sub: "approve" | "reject",
  proposalId: string,
): Promise<void> {
  if (!interaction.guildId || !interaction.member) return;
  const proposal = await ctx.db.query.proposals.findFirst({
    where: eq(schema.proposals.id, proposalId),
  });
  if (!proposal || proposal.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "I can't find that plan vote anymore.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guild = await ensureGuild(ctx.db, interaction.guildId, ctx.config);

  if (sub === "reject") {
    const isAuthor = interaction.user.id === proposal.authorId;
    if (!isAuthor && !canApprovePlan(guild, interaction.member)) {
      await interaction.reply({
        content: "Only the requester or an approver can reject this plan.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await ctx.db
      .update(schema.proposals)
      .set({ status: "dismissed" })
      .where(eq(schema.proposals.id, proposalId));
    await interaction.update({
      content: `~~${truncate(proposal.summary, 100)}~~ — plan rejected by ${interaction.user.username}.`,
      components: [],
    });
    return;
  }

  if (!canApprovePlan(guild, interaction.member)) {
    await interaction.reply({
      content:
        guild.planVoteMode === "role_gated"
          ? "Plan approval is role-gated here — you don't have the approver role."
          : "You don't have permission to approve agent tasks here.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const result = await approvePlanProposal(
    ctx,
    proposal,
    { id: interaction.user.id, username: interaction.user.username },
    interaction.client,
  );
  if (!result.ok) {
    await interaction.reply({
      content: result.reason ?? "Couldn't approve that.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.update({
    content: `🧵 **${proposal.repoFullName}** — ${truncate(proposal.summary, 100)} (plan approved by ${interaction.user.username})`,
    components: [],
  });
}
