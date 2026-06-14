import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { schema } from "@anywarecode/db";
import { listInstallations } from "../github/installations.js";
import { ensureGuild } from "./gates.js";
import type { BotContext } from "./interactions.js";

/**
 * /oss apply — request the free OSS Community tier. Eligibility check (all
 * installation repos public) runs here; the grant itself happens via the
 * operator's admin route, which sets planId/ossStatus/caps.
 */
export async function handleOssCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server admins can apply for the OSS Community tier.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);

  if (guild.ossStatus === "approved") {
    await interaction.reply({
      content: "✅ This server is already on the OSS Community tier.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (guild.ossStatus === "pending") {
    await interaction.reply({
      content: "⏳ Your OSS application is pending review.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const installations = await listInstallations(ctx.db, guildId);
  if (installations.length === 0) {
    await interaction.reply({
      content: "Connect GitHub first (`/connect github`) — the OSS tier is for public repos.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const repos = (
    await Promise.all(
      installations.map((i) =>
        ctx.github
          .listReposWithVisibility(i.installationId)
          .catch(() => [] as Array<{ fullName: string; private: boolean }>),
      ),
    )
  ).flat();
  if (repos.length === 0) {
    await interaction.editReply(
      "The GitHub installation has no repos. Grant access to your public repos, then retry.",
    );
    return;
  }
  const privateRepos = repos.filter((r) => r.private).map((r) => r.fullName);
  if (privateRepos.length > 0) {
    const shown = privateRepos.slice(0, 10).map((r) => `\`${r}\``).join(", ");
    await interaction.editReply(
      `The OSS Community tier requires every connected repo to be public. Private: ${shown}${
        privateRepos.length > 10 ? ` (+${privateRepos.length - 10} more)` : ""
      }. Remove them from the installation or make them public, then retry.`,
    );
    return;
  }

  await ctx.db
    .update(schema.guilds)
    .set({ ossStatus: "pending", ossAppliedAt: new Date() })
    .where(eq(schema.guilds.id, guildId));
  await interaction.editReply(
    "📨 OSS Community application submitted — an operator will review it. Check `/billing` for status.",
  );
}
