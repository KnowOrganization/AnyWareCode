import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  createUserLinkState,
  getUserLink,
  removeUserLink,
  userLinkAuthorizeUrl,
  userLinkingEnabled,
} from "../github/user-link.js";
import type { BotContext } from "./interactions.js";

/** /link github [remove] — verify (or drop) the member's GitHub identity. */
export async function handleLinkCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!userLinkingEnabled(ctx.config)) {
    await interaction.reply({
      content: "GitHub identity linking isn't configured on this bot (operator: set GITHUB_CLIENT_ID/SECRET).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === "remove") {
    const removed = await removeUserLink(ctx.db, interaction.user.id);
    await interaction.reply({
      content: removed
        ? "🔓 GitHub identity unlinked."
        : "Nothing to unlink — you haven't linked a GitHub account.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existing = await getUserLink(ctx.db, interaction.user.id);
  const state = await createUserLinkState(
    ctx.db,
    ctx.config.STATE_SECRET,
    interaction.user.id,
    ctx.config.INSTALL_STATE_TTL_MINUTES,
  );
  await interaction.reply({
    content: [
      existing
        ? `Currently linked as **${existing.githubLogin}**. Re-link to change it:`
        : "Link your GitHub identity — your sponsored agent PRs will carry it in their provenance receipt:",
      `[Authorize on GitHub](${userLinkAuthorizeUrl(ctx.config, state)}) (link valid ${ctx.config.INSTALL_STATE_TTL_MINUTES} min, only your public login is stored)`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
