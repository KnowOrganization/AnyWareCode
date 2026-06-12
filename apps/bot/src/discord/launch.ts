import {
  Routes,
  type APIInteractionGuildMember,
  type Client,
  type GuildMember,
  type ThreadChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import type { TranscriptEntry } from "@anywherecode/shared";
import { schema } from "@anywherecode/db";
import type { Guild } from "@anywherecode/db";
import { getOrgTrial } from "@anywherecode/db";
import { isClaudeOauthEnabled } from "../flags.js";
import { createInstallState } from "../github/install-state.js";
import { resolveLlmAuth, type ResolvedLlmAuth } from "../llm/credentials.js";
import { captureError } from "../observability.js";
import { bumpUsage } from "../orchestrator/usage.js";
import { allowPlatformKey, canInvoke, capState, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { checkTrialGates } from "./trial-gates.js";

/**
 * Shared task-launch path. All entry points (slash commands, the Iterate
 * button, @mentions, proposal Run buttons) funnel through here so permission,
 * cap, repo and usage accounting live in exactly one place.
 */

export type PreconditionResult =
  | { ok: true; repoFullName: string; installationId: number }
  | { ok: false; reason: string };

/** Where the task's repo comes from: a bound channel, or directly (webhook
 * features like the issue feed name the repo without a channel binding). */
export type RepoRef = { channelId: string } | { repoFullName: string };

export async function checkTaskPreconditions(
  ctx: BotContext,
  guild: Guild,
  member: GuildMember | APIInteractionGuildMember | null,
  mode: "code" | "ask",
  repoRef: RepoRef,
  prompt: string,
): Promise<PreconditionResult> {
  if (!member) {
    return { ok: false, reason: "Couldn't resolve your server membership; try again." };
  }
  if (!canInvoke(guild, member)) {
    return {
      ok: false,
      reason:
        "You don't have permission to run agent tasks here. Ask an admin to grant your role with `/config role`.",
    };
  }
  return checkSystemTaskPreconditions(ctx, guild, mode, repoRef, prompt);
}

/**
 * Everything except the member check — system-initiated launches (auto-review)
 * have no clicking member. Human entry points go through
 * checkTaskPreconditions, which adds the membership/permission gate.
 */
export async function checkSystemTaskPreconditions(
  ctx: BotContext,
  guild: Guild,
  mode: "code" | "ask",
  repoRef: RepoRef,
  prompt: string,
): Promise<PreconditionResult> {
  if (guild.suspended) {
    return {
      ok: false,
      reason: "This server's access has been suspended. Contact the operator.",
    };
  }
  if (prompt.trim().length === 0) {
    return { ok: false, reason: "Give me something to work on — the task is empty." };
  }
  if (prompt.length > ctx.config.MAX_PROMPT_CHARS) {
    return {
      ok: false,
      reason: `That's too long (${prompt.length} chars; max ${ctx.config.MAX_PROMPT_CHARS}). Trim it and try again.`,
    };
  }
  if (!guild.githubInstallationId) {
    const state = await createInstallState(
      ctx.db,
      ctx.config.STATE_SECRET,
      guild.id,
      ctx.config.INSTALL_STATE_TTL_MINUTES,
    );
    return {
      ok: false,
      reason: `GitHub isn't connected yet. An admin needs to [install the GitHub App](${ctx.github.installUrl(state)}).`,
    };
  }
  const llmRes = await resolveLlmAuth(ctx.db, ctx.config, guild.id);
  if (!llmRes.auth) {
    return { ok: false, reason: "LLM not connected. An admin needs to run `/connect llm`." };
  }
  const usable = await assertLlmUsable(ctx, guild, llmRes);
  if (!usable.ok) return usable;

  let repoFullName: string;
  if ("repoFullName" in repoRef) {
    repoFullName = repoRef.repoFullName;
  } else {
    const channelRepo = await ctx.db.query.channelRepos.findFirst({
      where: eq(schema.channelRepos.channelId, repoRef.channelId),
    });
    if (!channelRepo) {
      return {
        ok: false,
        reason: "No repo set for this channel yet — run `/repo set` first.",
      };
    }
    repoFullName = channelRepo.repoFullName;
  }
  // OSS tier is for public repos only; recheck lazily in case one went private.
  if (
    resolveTier(guild).kind === "oss" &&
    (await ctx.github.repoIsPrivate(guild.githubInstallationId, repoFullName))
  ) {
    return {
      ok: false,
      reason: `\`${repoFullName}\` is private — the OSS Community tier only runs on public repos.`,
    };
  }
  const cap = capState(guild, mode);
  if (cap.exceeded) {
    return { ok: false, reason: capExceededMessage(ctx, guild, mode, cap) };
  }
  return {
    ok: true,
    repoFullName,
    installationId: guild.githubInstallationId,
  };
}

/**
 * Shared credential gating used by the launch funnel and the mention handler:
 * platform-key trial rules (tier + abuse gates + one-trial-per-org) and the
 * claude_oauth kill switch.
 */
export async function assertLlmUsable(
  ctx: BotContext,
  guild: Guild,
  resolved: ResolvedLlmAuth,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!resolved.auth) {
    return { ok: false, reason: "LLM not connected. An admin needs to run `/connect llm`." };
  }
  if (
    resolved.auth.type === "claude_oauth" &&
    !(await isClaudeOauthEnabled(ctx.db))
  ) {
    return {
      ok: false,
      reason:
        "Subscription-token connections are currently disabled. An admin should run `/connect llm` and switch to an Anthropic API key.",
    };
  }
  if (resolved.source !== "platform") return { ok: true };
  // The platform key is a trial convenience only; paid + post-trial tiers must BYO.
  if (!allowPlatformKey(guild)) {
    return { ok: false, reason: trialEndedMessage(ctx) };
  }
  const gates = await checkTrialGates(ctx.client, ctx.db, ctx.config, guild);
  if (!gates.ok) return gates;
  if (guild.githubAccountLogin) {
    const orgTrial = await getOrgTrial(ctx.db, guild.githubAccountLogin);
    if (orgTrial && orgTrial.guildId !== guild.id) {
      return {
        ok: false,
        reason:
          "This GitHub org already used its free trial in another server. Connect your own LLM key with `/connect llm` or pick a plan.",
      };
    }
  }
  return { ok: true };
}

/** Cap-hit copy; the growth hook is that any member can buy a pack. */
export function capExceededMessage(
  ctx: BotContext,
  guild: Guild,
  mode: "code" | "ask",
  cap: { used: number; cap: number },
): string {
  const base = `This server hit its monthly ${mode === "code" ? "task" : "question"} limit (${cap.used}/${cap.cap}). Resets ${guild.capResetAt.toDateString()}.`;
  if (mode !== "code" || !ctx.config.WEB_URL) return base;
  return `${base}\nAny member can add more — buy a task pack at ${ctx.config.WEB_URL}/packs/${guild.id}, or upgrade at ${ctx.config.WEB_URL}/dashboard/${guild.id}.`;
}

export type ThreadStrategy =
  | {
      kind: "create";
      client: Client;
      /** Text channel holding the anchor message the thread is opened from. */
      channelId: string;
      anchorMessageId: string;
      name: string;
    }
  | { kind: "existing"; thread: ThreadChannel };

export interface LaunchTaskRequest {
  guildId: string;
  installationId: number;
  repoFullName: string;
  /** Parent text channel recorded on the task row (repo binding channel). */
  channelId: string;
  mode: "code" | "ask";
  prompt: string;
  requestedBy: string;
  thread: ThreadStrategy;
  iterate?: { branch: string; prNumber: number; transcript: TranscriptEntry[] };
  /** Ask mode only: clone this ref instead of the default branch (PR review). */
  checkoutRef?: string;
  /** Ask mode only: also post the final summary as an embed to this channel. */
  summaryTarget?: { channelId: string; title: string };
}

export async function launchTask(
  ctx: BotContext,
  req: LaunchTaskRequest,
): Promise<ThreadChannel> {
  let thread: ThreadChannel;
  if (req.thread.kind === "existing") {
    thread = req.thread.thread;
  } else {
    // Use REST directly — avoids requiring the parent channel to be in discord.js cache
    const { client, channelId, anchorMessageId, name } = req.thread;
    const threadRaw = (await client.rest.post(
      Routes.threads(channelId, anchorMessageId),
      {
        body: {
          name: truncate(name, 90),
          auto_archive_duration: 1440,
        },
      },
    )) as { id: string };
    thread = (await client.channels.fetch(threadRaw.id)) as ThreadChannel;
  }

  const fundedBy = await bumpUsage(ctx.db, req.guildId, req.mode);
  void ctx.orchestrator
    .run({
      guildId: req.guildId,
      installationId: req.installationId,
      channelId: req.channelId,
      thread,
      repoFullName: req.repoFullName,
      prompt: req.prompt,
      requestedBy: req.requestedBy,
      mode: req.mode,
      fundedBy,
      ...(req.iterate ? { iterate: req.iterate } : {}),
      ...(req.checkoutRef ? { checkoutRef: req.checkoutRef } : {}),
      ...(req.summaryTarget ? { summaryTarget: req.summaryTarget } : {}),
    })
    .catch(async (err: unknown) => {
      captureError(err, { msg: "task crashed", threadId: thread.id });
      await thread
        .send("⚠️ The task crashed before finishing. Check the bot logs.")
        .catch(() => {});
    });
  return thread;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Shown when a guild past its trial tries to ride the platform key. */
export function trialEndedMessage(ctx: BotContext): string {
  const plans = ctx.config.WEB_URL ? ` and pick a plan at ${ctx.config.WEB_URL}` : "";
  return `Your free trial has ended. Connect your own LLM key with \`/connect llm\`${plans} to keep going.`;
}
