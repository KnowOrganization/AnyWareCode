import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Message,
  type VoiceBasedChannel,
} from "discord.js";
import {
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
  type VoiceConnection,
} from "@discordjs/voice";
import { eq } from "drizzle-orm";
import { schema } from "@anywarecode/db";
import { resolveLlmAuth } from "../llm/credentials.js";
import { extractActionItems } from "../llm/standup.js";
import { captureError, log } from "../observability.js";
import { sanitizeUntrusted } from "../security/quarantine.js";
import { canInvoke, ensureGuild } from "../discord/gates.js";
import type { BotContext } from "../discord/interactions.js";
import { truncate } from "../discord/launch.js";
import { createProposal, setProposalMessageId } from "../discord/proposals.js";
import { captureUtterance } from "./capture.js";
import { stereo48kToMono16k, wavFromMono16k } from "./pcm.js";
import { transcribeWav } from "./transcribe.js";

/**
 * Voice → PR ("Standup Mode", Studio tier). Privacy-first by construction:
 * explicit /standup start, a visible 🔴 indicator message, transcript held
 * only in memory, and everything dropped the moment proposals are posted. A
 * crash loses the transcript — that's the correct failure mode.
 */

interface TranscriptEntry {
  speaker: string;
  text: string;
  ts: number;
}

interface StandupSession {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  repoFullName: string;
  connection: VoiceConnection;
  transcript: TranscriptEntry[];
  capturing: Set<string>;
  indicator: Message | null;
  startedAt: number;
  maxTimer: NodeJS.Timeout;
  watchdog: NodeJS.Timeout;
  stopping: boolean;
}

const sessions = new Map<string, StandupSession>();
const GLOBAL_SESSION_CAP = 5;

export async function handleStandupCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "start") return startStandup(ctx, interaction);
  if (sub === "stop") return stopStandupCommand(ctx, interaction);
}

async function startStandup(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);

  if (!interaction.member || !canInvoke(guild, interaction.member)) {
    await interaction.reply({
      content: "You don't have permission to start a standup session.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!ctx.config.OPENAI_API_KEY) {
    await interaction.reply({
      content: "Standup transcription isn't configured (operator: set OPENAI_API_KEY).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const repoRow = await ctx.db.query.channelRepos.findFirst({
    where: eq(schema.channelRepos.channelId, interaction.channelId),
  });
  if (!repoRow) {
    await interaction.reply({
      content: "Run `/standup start` in a repo-bound text channel (`/repo set`) — action-item cards post there.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (sessions.has(guildId)) {
    await interaction.reply({
      content: "A standup session is already running in this server — `/standup stop` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (sessions.size >= GLOBAL_SESSION_CAP) {
    await interaction.reply({
      content: "The bot is at its concurrent standup limit right now — try again shortly.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = await interaction.guild?.members
    .fetch(interaction.user.id)
    .catch(() => null);
  const voiceChannel = member?.voice.channel;
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "Join a voice channel first — I'll listen there.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  const session: StandupSession = {
    guildId,
    voiceChannelId: voiceChannel.id,
    textChannelId: interaction.channelId,
    repoFullName: repoRow.repoFullName,
    connection,
    transcript: [],
    capturing: new Set(),
    indicator: null,
    startedAt: Date.now(),
    maxTimer: setTimeout(
      () => void endSession(ctx, guildId, "time limit reached"),
      ctx.config.STANDUP_MAX_MINUTES * 60_000,
    ),
    watchdog: setInterval(() => void watchdogTick(ctx, guildId), 30_000),
    stopping: false,
  };
  session.maxTimer.unref();
  session.watchdog.unref();
  sessions.set(guildId, session);

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    // Mod dragged the bot out / channel deleted → treat as stop.
    void endSession(ctx, guildId, "disconnected");
  });

  const receiver = connection.receiver;
  receiver.speaking.on("start", (userId) => {
    const s = sessions.get(guildId);
    if (!s || s.stopping || s.capturing.has(userId)) return;
    s.capturing.add(userId);
    void captureAndTranscribe(ctx, s, voiceChannel, userId)
      .catch((err) => log.warn({ err }, "utterance capture failed"))
      .finally(() => s.capturing.delete(userId));
  });

  session.indicator = await interaction.editReply({
    content: `🔴 **Recording standup** in <#${voiceChannel.id}> — action items become proposal cards here when it ends. \`/standup stop\` to finish (auto-stops after ${ctx.config.STANDUP_MAX_MINUTES} min or when the channel empties). Transcript is memory-only and deleted afterwards.`,
  });
}

async function captureAndTranscribe(
  ctx: BotContext,
  session: StandupSession,
  voiceChannel: VoiceBasedChannel,
  userId: string,
): Promise<void> {
  const pcm = await captureUtterance(
    session.connection.receiver,
    userId,
    ctx.config.STANDUP_MAX_UTTERANCE_SECONDS,
  );
  // Under ~0.5s of audio is throat-clearing, not speech.
  if (session.stopping || pcm.length < 96_000) return;
  const wav = wavFromMono16k(stereo48kToMono16k(pcm));
  const text = await transcribeWav(ctx.config.OPENAI_API_KEY!, wav);
  if (!text || session.stopping) return;
  const member = await voiceChannel.guild.members.fetch(userId).catch(() => null);
  session.transcript.push({
    speaker: member?.displayName ?? "someone",
    // Whisper output is untrusted speech; same quarantine as written input.
    text: sanitizeUntrusted(text).text,
    ts: Date.now(),
  });
}

async function watchdogTick(ctx: BotContext, guildId: string): Promise<void> {
  const session = sessions.get(guildId);
  if (!session || session.stopping) return;
  if (session.connection.state.status === VoiceConnectionStatus.Destroyed) {
    await endSession(ctx, guildId, "connection lost");
    return;
  }
  const channel = await ctx.client.channels
    .fetch(session.voiceChannelId)
    .catch(() => null);
  if (!channel?.isVoiceBased()) return;
  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans === 0) await endSession(ctx, guildId, "everyone left");
}

async function stopStandupCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const session = sessions.get(guildId);
  if (!session) {
    await interaction.reply({
      content: "No standup session is running.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Anyone in that voice channel may stop the recording — privacy control.
  const member = await interaction.guild?.members
    .fetch(interaction.user.id)
    .catch(() => null);
  const inChannel = member?.voice.channelId === session.voiceChannelId;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  const mayInvoke = Boolean(
    interaction.member && canInvoke(guild, interaction.member),
  );
  if (!inChannel && !mayInvoke) {
    await interaction.reply({
      content: "Only people in the voice channel (or authorized members) can stop the session.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply("🛑 Standup stopped — distilling action items…");
  await endSession(ctx, guildId, `stopped by ${interaction.user.username}`);
}

async function endSession(
  ctx: BotContext,
  guildId: string,
  reason: string,
): Promise<void> {
  const session = sessions.get(guildId);
  if (!session || session.stopping) return;
  session.stopping = true;
  clearTimeout(session.maxTimer);
  clearInterval(session.watchdog);
  try {
    session.connection.destroy();
  } catch {
    /* already gone */
  }
  getVoiceConnection(guildId)?.destroy();
  sessions.delete(guildId);

  const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000));
  const transcript = session.transcript;
  session.transcript = []; // drop the only copy

  try {
    const resolved = await resolveLlmAuth(ctx.db, ctx.config, guildId);
    const items = resolved.auth
      ? await extractActionItems(
          resolved.auth,
          ctx.config.CHAT_MODEL,
          transcript.map(({ speaker, text }) => ({ speaker, text })),
        )
      : [];

    const channel = await ctx.client.channels
      .fetch(session.textChannelId)
      .catch(() => null);
    if (!channel?.isSendable()) return;

    for (const item of items) {
      const { id } = await createProposal(ctx, {
        guildId,
        channelId: session.textChannelId,
        threadId: null,
        authorId: ctx.client.user?.id ?? "system",
        prompt: item.task_prompt,
        summary: item.summary,
        repoFullName: session.repoFullName,
        source: "standup",
        ttlMs: ctx.config.SCHEDULE_PROPOSAL_TTL_HOURS * 3_600_000,
      });
      const card = await channel.send({
        content: `🎙️ **From standup** — ${item.speaker} said: **${truncate(item.summary, 100)}**\n> ${truncate(item.task_prompt, 240)}\nWant me on it?`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`aw:proposal:run:${id}`)
              .setLabel("Run it")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`aw:proposal:dismiss:${id}`)
              .setLabel("Dismiss")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        allowedMentions: { parse: [] },
      });
      await setProposalMessageId(ctx.db, id, card.id);
    }

    await channel.send({
      content: `⏹️ Standup ended (${reason}) — ${minutes} min, ${items.length === 0 ? "nothing actionable heard" : `${items.length} action item(s) above`}. Transcript deleted.`,
      allowedMentions: { parse: [] },
    });
    await session.indicator
      ?.edit({
        content: `⚪ Standup recording ended (${reason}). Transcript deleted.`,
      })
      .catch(() => {});
  } catch (err) {
    captureError(err, { msg: "standup wrap-up failed", guildId });
  }
}
