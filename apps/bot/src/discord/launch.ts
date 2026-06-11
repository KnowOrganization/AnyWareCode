import {
  Routes,
  type APIInteractionGuildMember,
  type Client,
  type GuildMember,
  type ThreadChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import type { TranscriptEntry } from "@anywherecode/shared";
import { schema } from "../db/index.js";
import type { Guild } from "../db/schema.js";
import { createInstallState } from "../github/install-state.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { bumpUsage } from "../orchestrator/usage.js";
import { canInvoke, capState } from "./gates.js";
import type { BotContext } from "./interactions.js";

/**
 * Shared task-launch path. All entry points (slash commands, the Iterate
 * button, @mentions, proposal Run buttons) funnel through here so permission,
 * cap, repo and usage accounting live in exactly one place.
 */

export type PreconditionResult =
  | { ok: true; repoFullName: string; installationId: number }
  | { ok: false; reason: string };

export async function checkTaskPreconditions(
  ctx: BotContext,
  guild: Guild,
  member: GuildMember | APIInteractionGuildMember | null,
  mode: "code" | "ask",
  repoChannelId: string,
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
  const channelRepo = await ctx.db.query.channelRepos.findFirst({
    where: eq(schema.channelRepos.channelId, repoChannelId),
  });
  if (!channelRepo) {
    return {
      ok: false,
      reason: "No repo set for this channel yet — run `/repo set` first.",
    };
  }
  const cap = capState(guild, mode);
  if (cap.exceeded) {
    return {
      ok: false,
      reason: `This server hit its monthly ${mode === "code" ? "task" : "question"} limit (${cap.used}/${cap.cap}). Resets ${guild.capResetAt.toDateString()}.`,
    };
  }
  return {
    ok: true,
    repoFullName: channelRepo.repoFullName,
    installationId: guild.githubInstallationId,
  };
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

  await bumpUsage(ctx.db, req.guildId, req.mode);
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
      ...(req.iterate ? { iterate: req.iterate } : {}),
    })
    .catch(async (err: unknown) => {
      console.error(`task in thread ${thread.id} failed`, err);
      await thread
        .send("⚠️ The task crashed before finishing. Check the bot logs.")
        .catch(() => {});
    });
  return thread;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
