import type { GuildMember, Message, ThreadChannel } from "discord.js";
import { desc, eq } from "drizzle-orm";
import { schema } from "@anywherecode/db";
import type { Task } from "@anywherecode/db";
import {
  classifyIntent,
  type ChatContext,
  type HistoryMessage,
  type IntentDecision,
} from "../llm/chat.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { canInvoke, capState, ensureGuild } from "./gates.js";
import type { BotContext } from "./interactions.js";
import {
  assertLlmUsable,
  checkTaskPreconditions,
  launchTask,
  truncate,
} from "./launch.js";
import { maybeRequirePlanVote } from "./plan-votes.js";
import {
  createProposal,
  proposalMessage,
  setProposalMessageId,
} from "./proposals.js";
import { captureError } from "../observability.js";

/**
 * @mention participation. A direct mention anywhere classifies the
 * conversation with one bot-side LLM call and either chats back, runs an
 * ask/code task, or proposes an inferred task. Detection is content-based:
 * only an explicit <@id>/<@&roleId> token counts — implicit reply pings and
 * @everyone/@here never trigger.
 */

const HISTORY_LIMIT = 25;

export function isBotMentioned(
  content: string,
  botUserId: string,
  botRoleIds: string[],
): boolean {
  if (new RegExp(`<@!?${botUserId}>`).test(content)) return true;
  return botRoleIds.some((id) => content.includes(`<@&${id}>`));
}

export function stripBotMention(
  content: string,
  botUserId: string,
  botRoleIds: string[],
): string {
  let out = content.replaceAll(new RegExp(`<@!?${botUserId}>`, "g"), " ");
  for (const id of botRoleIds) {
    out = out.replaceAll(`<@&${id}>`, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export type MessageRoute =
  | { kind: "ignore" }
  | { kind: "forward" }
  | { kind: "classify"; scope: "channel" | "thread" };

export function routeMessage(flags: {
  isBot: boolean;
  isThread: boolean;
  hasActiveTask: boolean;
  isMentioned: boolean;
  hasContent: boolean;
}): MessageRoute {
  if (flags.isBot || !flags.hasContent) return { kind: "ignore" };
  if (flags.isThread) {
    if (flags.hasActiveTask) return { kind: "forward" };
    return flags.isMentioned
      ? { kind: "classify", scope: "thread" }
      : { kind: "ignore" };
  }
  return flags.isMentioned
    ? { kind: "classify", scope: "channel" }
    : { kind: "ignore" };
}

/** Sliding-window limiter for classification calls — abuse damping, not billing. */
export class ChatRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private perMinute: number) {}

  allow(guildId: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(guildId) ?? []).filter(
      (t) => t > now - 60_000,
    );
    if (recent.length >= this.perMinute) {
      this.hits.set(guildId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(guildId, recent);
    return true;
  }
}

let limiter: ChatRateLimiter | undefined;

export async function handleMention(
  ctx: BotContext,
  message: Message<true>,
): Promise<void> {
  const guild = await ensureGuild(
    ctx.db,
    message.guildId,
    ctx.config,
  );
  limiter ??= new ChatRateLimiter(ctx.config.CHAT_RATE_PER_MINUTE);
  if (!limiter.allow(message.guildId)) {
    await message.react("⏳").catch(() => {});
    return;
  }

  const llm = await resolveLlmAuth(ctx.db, ctx.config, message.guildId);
  if (!llm.auth) {
    await reply(
      message,
      "I can't think yet — an admin needs to run `/connect llm` first.",
    );
    return;
  }
  // Same credential gating as task launches: trial rules (platform key, abuse
  // gates, org dedup) and the claude_oauth kill switch.
  const usable = await assertLlmUsable(ctx, guild, llm);
  if (!usable.ok) {
    await reply(message, usable.reason);
    return;
  }

  const typing = startTyping(message);
  try {
    const botId = message.client.user.id;
    const botRoleIds = botRoleIdsOf(message);
    const isThread = message.channel.isThread();
    const repoChannelId = isThread
      ? (message.channel.parentId ?? message.channelId)
      : message.channelId;
    const channelRepo = await ctx.db.query.channelRepos.findFirst({
      where: eq(schema.channelRepos.channelId, repoChannelId),
    });
    const threadTask = isThread
      ? await latestTaskForThread(ctx, message.channelId)
      : null;

    const chatCtx: ChatContext = {
      history: await fetchHistory(message),
      mention: {
        author: message.author.displayName,
        text: stripBotMention(message.content, botId, botRoleIds),
      },
      channelName: channelName(message),
      repoFullName: channelRepo?.repoFullName ?? null,
      ...(threadTask
        ? {
            finishedTask: {
              prompt: threadTask.prompt,
              prNumber: threadTask.prNumber,
              status: threadTask.status,
            },
          }
        : {}),
    };

    const decision = await classifyIntent(
      llm.auth,
      ctx.config.CHAT_MODEL,
      chatCtx,
    );
    await actOnDecision(ctx, message, decision, {
      guild,
      repoChannelId,
      repoFullName: channelRepo?.repoFullName ?? null,
      threadTask,
    });
  } catch (err) {
    captureError(err, { msg: "mention handling failed", guildId: message.guildId });
    await reply(
      message,
      "⚠️ I had trouble processing that — try again in a moment.",
    );
  } finally {
    typing.stop();
  }
}

async function actOnDecision(
  ctx: BotContext,
  message: Message<true>,
  decision: IntentDecision,
  env: {
    guild: Awaited<ReturnType<typeof ensureGuild>>;
    repoChannelId: string;
    repoFullName: string | null;
    threadTask: Task | null;
  },
): Promise<void> {
  if (decision.action === "reply") {
    await reply(message, truncate(decision.reply_text ?? "…", 2000));
    return;
  }

  const prompt = decision.task_prompt ?? "";
  const summary = decision.task_summary ?? truncate(prompt, 80);

  if (decision.action === "propose_code") {
    if (!env.repoFullName) {
      await reply(
        message,
        "I'd propose a task, but no repo is bound here — an admin needs to run `/repo set` first.",
      );
      return;
    }
    const { id } = await createProposal(ctx, {
      guildId: message.guildId,
      channelId: env.repoChannelId,
      threadId: message.channel.isThread() ? message.channelId : null,
      authorId: message.author.id,
      prompt,
      summary,
      repoFullName: env.repoFullName,
    });
    await message.reply({
      ...proposalMessage(summary, prompt, id),
      allowedMentions: { parse: [], repliedUser: true },
    });
    return;
  }

  // ask / code: gated execution.
  const mode = decision.action;
  const member = await resolveMember(message);
  if (!member || !canInvoke(env.guild, member)) {
    await reply(
      message,
      "Happy to chat, but running tasks needs the runner role — ask an admin about `/config role`.",
    );
    return;
  }

  // Finished task thread with a PR + code intent -> iterate on that PR.
  if (
    mode === "code" &&
    env.threadTask?.prNumber &&
    env.guild.githubInstallationId &&
    message.channel.isThread()
  ) {
    const task = env.threadTask;
    const cap = capState(env.guild, "code");
    if (cap.exceeded) {
      await reply(
        message,
        `This server hit its monthly task limit (${cap.used}/${cap.cap}).`,
      );
      return;
    }
    const feedback = await ctx.github.pullRequestFeedback(
      env.guild.githubInstallationId,
      task.repoFullName,
      task.prNumber!,
    );
    await reply(message, `🔁 Iterating on PR #${task.prNumber}…`);
    await launchTask(ctx, {
      guildId: message.guildId,
      installationId: env.guild.githubInstallationId,
      repoFullName: task.repoFullName,
      channelId: task.channelId,
      mode: "code",
      prompt,
      requestedBy: message.author.username,
      requestedById: message.author.id,
      thread: { kind: "existing", thread: message.channel as ThreadChannel },
      iterate: {
        branch: task.branch,
        prNumber: task.prNumber!,
        transcript: feedback,
      },
    });
    return;
  }

  const pre = await checkTaskPreconditions(
    ctx,
    env.guild,
    member,
    mode,
    { channelId: env.repoChannelId },
    prompt,
  );
  if (!pre.ok) {
    await reply(message, pre.reason);
    return;
  }

  if (message.channel.isThread()) {
    // Threads can't nest; run in place.
    await reply(
      message,
      `${mode === "code" ? "🧵" : "💬"} On it — **${pre.repoFullName}**.`,
    );
    await launchTask(ctx, {
      guildId: message.guildId,
      installationId: pre.installationId,
      repoFullName: pre.repoFullName,
      channelId: env.repoChannelId,
      mode,
      prompt,
      requestedBy: message.author.username,
      requestedById: message.author.id,
      thread: { kind: "existing", thread: message.channel as ThreadChannel },
    });
    return;
  }

  if (mode === "code") {
    const decision = await maybeRequirePlanVote(ctx, {
      guild: env.guild,
      authorId: message.author.id,
      repoFullName: pre.repoFullName,
      channelId: message.channelId,
      prompt,
      summary,
    });
    if (decision.kind === "vote") {
      const card = await message.reply({
        content: decision.card.content ?? "",
        components: decision.card.components ?? [],
        allowedMentions: { parse: [] },
      });
      await setProposalMessageId(ctx.db, decision.proposalId, card.id);
      return;
    }
  }

  await launchTask(ctx, {
    guildId: message.guildId,
    installationId: pre.installationId,
    repoFullName: pre.repoFullName,
    channelId: message.channelId,
    mode,
    prompt,
    requestedBy: message.author.username,
      requestedById: message.author.id,
    thread: {
      kind: "create",
      client: message.client,
      channelId: message.channelId,
      anchorMessageId: message.id,
      name: `${mode}: ${summary}`,
    },
  });
}

export function botRoleIdsOf(message: Message<true>): string[] {
  return message.guild.members.me?.roles.cache.map((r) => r.id) ?? [];
}

async function fetchHistory(message: Message<true>): Promise<HistoryMessage[]> {
  const fetched = await message.channel.messages
    .fetch({ limit: HISTORY_LIMIT, before: message.id })
    .catch(() => null);
  if (!fetched) return [];
  // fetch() returns newest-first; the classifier wants oldest-first.
  return [...fetched.values()]
    .reverse()
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      author: m.author.displayName,
      isBot: m.author.bot,
      timestamp: m.createdAt.toISOString(),
      text: m.content,
    }));
}

async function latestTaskForThread(
  ctx: BotContext,
  threadId: string,
): Promise<Task | null> {
  const row = await ctx.db.query.tasks.findFirst({
    where: eq(schema.tasks.threadId, threadId),
    orderBy: desc(schema.tasks.createdAt),
  });
  return row ?? null;
}

async function resolveMember(
  message: Message<true>,
): Promise<GuildMember | null> {
  if (message.member) return message.member;
  return message.guild.members.fetch(message.author.id).catch(() => null);
}

function channelName(message: Message<true>): string {
  const ch = message.channel;
  return "name" in ch && typeof ch.name === "string" ? ch.name : "channel";
}

/** Untrusted-derived output must never ping anyone except the replied user. */
async function reply(message: Message<true>, content: string): Promise<void> {
  await message
    .reply({ content, allowedMentions: { parse: [], repliedUser: true } })
    .catch(() => {});
}

function startTyping(message: Message<true>): { stop: () => void } {
  const send = (): void => {
    if ("sendTyping" in message.channel) {
      void message.channel.sendTyping().catch(() => {});
    }
  };
  send();
  const interval = setInterval(send, 8000);
  return { stop: () => clearInterval(interval) };
}
