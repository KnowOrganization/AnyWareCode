import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild as DiscordGuild,
  type GuildTextBasedChannel,
} from "discord.js";

export function welcomeMessage(installUrl: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("👋 AnywhereCode is here")
        .setDescription(
          [
            "I run coding tasks against your GitHub repos, right from Discord.",
            "",
            "**Setup (about a minute):**",
            "1. Click **Connect GitHub** and pick the repos I may touch.",
            "2. Click **Connect LLM** and paste your Anthropic API key or Claude subscription token.",
            "3. Run `/repo set` in a channel to choose its active repo.",
            "4. Type `/code <task>` — I'll work in a thread and open a PR.",
          ].join("\n"),
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Connect GitHub")
          .setStyle(ButtonStyle.Link)
          .setURL(installUrl),
        new ButtonBuilder()
          .setCustomId("aw:llm:setup")
          .setLabel("Connect LLM")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

/** A channel the bot can actually post the welcome / ready message in. */
export function findAnnounceChannel(
  guild: DiscordGuild,
): GuildTextBasedChannel | null {
  const me = guild.members.me;
  const usable = (channel: GuildTextBasedChannel): boolean =>
    me !== null &&
    channel
      .permissionsFor(me)
      .has(PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel);

  if (guild.systemChannel && usable(guild.systemChannel)) {
    return guild.systemChannel;
  }
  const fallback = guild.channels.cache.find(
    (channel): channel is Extract<typeof channel, GuildTextBasedChannel> =>
      channel.type === ChannelType.GuildText && usable(channel),
  );
  return fallback ?? null;
}
