import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import { schema } from "@anywherecode/db";
import { isClaudeOauthEnabled } from "../flags.js";
import { createInstallState } from "../github/install-state.js";
import {
  encryptCredential,
  validateLlmAuth,
  type LlmAuth,
} from "../llm/credentials.js";
import { capState, ensureGuild, planSummary } from "./gates.js";
import type { BotContext } from "./interactions.js";
import { handleConnectMcp } from "./mcp.js";

export async function handleConnectCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "llm") await handleConnectLlm(ctx, interaction);
  else if (sub === "github") await handleConnectGithub(ctx, interaction);
  else if (sub === "mcp") await handleConnectMcp(ctx, interaction);
}

async function handleConnectLlm(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server admins can connect an LLM.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  await interaction.reply(
    llmChooserMessage(
      guild.llmProviderType ?? null,
      await isClaudeOauthEnabled(ctx.db),
    ),
  );
}

async function handleConnectGithub(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server admins can connect GitHub.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId!;
  const state = await createInstallState(
    ctx.db,
    ctx.config.STATE_SECRET,
    guildId,
    ctx.config.INSTALL_STATE_TTL_MINUTES,
  );
  await interaction.reply({
    content: `Connect GitHub by [installing the app](${ctx.github.installUrl(state)}). Pick which repos I may access.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleLlmButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
  action: string,
): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "Only server admins can change the LLM credential.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "remove") {
    const guildId = interaction.guildId!;
    await ctx.db
      .update(schema.guilds)
      .set({
        llmProviderType: null,
        llmCredentialEnc: null,
        llmBaseUrl: null,
        llmModel: null,
        llmCredentialSetAt: null,
      })
      .where(eq(schema.guilds.id, guildId));
    await interaction.reply({
      content: "LLM credential removed. Use `/connect llm` to reconnect.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "setup") {
    // "Connect LLM" button from welcome message — show chooser
    if (!interaction.guildId) return;
    const guild = await ensureGuild(
      ctx.db,
      interaction.guildId,
      ctx.config,
    );
    await interaction.reply(
      llmChooserMessage(
        guild.llmProviderType ?? null,
        await isClaudeOauthEnabled(ctx.db),
      ),
    );
    return;
  }

  if (action === "claude_oauth" && !(await isClaudeOauthEnabled(ctx.db))) {
    await interaction.reply({
      content: oauthDisabledMessage,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modalBuilders: Record<string, () => ModalBuilder> = {
    anthropic_api_key: apiKeyModal,
    claude_oauth: oauthModal,
    custom: customModal,
  };
  const buildModal = modalBuilders[action];
  if (!buildModal) return;
  await interaction.showModal(buildModal());
}

export async function handleLlmModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
  providerType: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId!;

  let auth: LlmAuth;
  if (providerType === "anthropic_api_key") {
    const token = interaction.fields.getTextInputValue("token").trim();
    auth = { type: "anthropic_api_key", token };
  } else if (providerType === "claude_oauth") {
    // Re-check at submit time — the modal may have been open when the flag flipped.
    if (!(await isClaudeOauthEnabled(ctx.db))) {
      await interaction.editReply(oauthDisabledMessage);
      return;
    }
    const token = interaction.fields.getTextInputValue("token").trim();
    auth = { type: "claude_oauth", token };
  } else if (providerType === "custom") {
    const baseUrl = interaction.fields
      .getTextInputValue("base_url")
      .trim()
      .replace(/\/$/, "");
    const token = interaction.fields.getTextInputValue("token").trim();
    const model = interaction.fields.getTextInputValue("model").trim();

    if (ctx.config.CUSTOM_PROVIDER_ALLOWLIST) {
      const allowed = ctx.config.CUSTOM_PROVIDER_ALLOWLIST.split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      if (allowed.length > 0) {
        let host: string;
        try {
          host = new URL(baseUrl).hostname;
        } catch {
          await interaction.editReply("Invalid base URL.");
          return;
        }
        if (!allowed.includes(host)) {
          await interaction.editReply(
            `Host \`${host}\` is not in the allowed provider list. Ask the bot operator to add it.`,
          );
          return;
        }
      }
    }
    auth = { type: "custom", token, baseUrl, model };
  } else {
    return;
  }

  const validation = await validateLlmAuth(auth);
  if (!validation.ok) {
    await interaction.editReply(
      `Credential check failed: ${validation.reason}`,
    );
    return;
  }

  const enc = encryptCredential(ctx.config.CREDENTIAL_SECRET, guildId, auth.token);
  await ensureGuild(ctx.db, guildId, ctx.config);
  await ctx.db
    .update(schema.guilds)
    .set({
      llmProviderType: auth.type,
      llmCredentialEnc: enc,
      llmBaseUrl: auth.type === "custom" ? auth.baseUrl : null,
      llmModel: auth.type === "custom" ? auth.model : null,
      llmCredentialSetAt: new Date(),
    })
    .where(eq(schema.guilds.id, guildId));

  await interaction.editReply(
    `✅ LLM connected (${providerTypeLabel(auth.type)}) — ready for \`/code\`.`,
  );
}

export async function handleSetupCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);

  const githubStatus = guild.githubInstallationId
    ? `✅ GitHub connected (install #${guild.githubInstallationId})`
    : `❌ GitHub not connected — run \`/connect github\``;

  let llmStatus: string;
  if (guild.llmProviderType && guild.llmCredentialSetAt) {
    llmStatus = `✅ LLM connected (${providerTypeLabel(guild.llmProviderType)}, set ${guild.llmCredentialSetAt.toDateString()})`;
  } else if (ctx.config.ANTHROPIC_API_KEY) {
    llmStatus = `✅ LLM using platform key (operator-managed)`;
  } else {
    llmStatus = `❌ LLM not connected — run \`/connect llm\``;
  }

  const codeCap = capState(guild, "code");
  const askCap = capState(guild, "ask");
  const usageStatus = `📊 Usage this month: ${codeCap.used}/${codeCap.cap} code tasks, ${askCap.used}/${askCap.cap} questions`;

  await interaction.reply({
    content: [githubStatus, llmStatus, usageStatus].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleBillingCommand(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const guild = await ensureGuild(ctx.db, guildId, ctx.config);
  const plan = planSummary(guild);
  const code = capState(guild, "code");
  const ask = capState(guild, "ask");

  const lines = [`💳 **Plan:** ${plan.tier}`];
  if (plan.trialDaysLeft !== null) {
    lines.push(
      plan.trialDaysLeft > 0
        ? `⏳ Trial: ${plan.trialDaysLeft} day(s) left (running on the platform key).`
        : `⏳ Trial ended — connect your own key with \`/connect llm\`.`,
    );
  }
  if (plan.status === "past_due") {
    lines.push("⚠️ Payment overdue — update your card or the plan lapses.");
  }
  if (guild.currentPeriodEnd && plan.status === "active") {
    lines.push(`🔁 Renews ${guild.currentPeriodEnd.toDateString()}.`);
  }
  if (guild.ossStatus === "pending") {
    lines.push("🌱 OSS Community application pending review.");
  } else if (guild.ossStatus === "rejected") {
    lines.push("🌱 OSS Community application was not approved.");
  }
  const askUsage = ask.unlimited
    ? `${ask.used}/∞ questions`
    : `${ask.used}/${ask.cap} questions`;
  lines.push(
    `📊 This month: ${code.used}/${code.cap} code tasks, ${askUsage}.`,
  );
  lines.push(`🔋 Pack balance: ${plan.packRemaining} task(s).`);

  const buttons: ButtonBuilder[] = [];
  if (ctx.config.WEB_URL) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(plan.status === "active" ? "Manage billing" : "Upgrade")
        .setURL(`${ctx.config.WEB_URL}/dashboard/${guildId}`),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Buy a task pack 🔋")
        .setURL(`${ctx.config.WEB_URL}/packs/${guildId}`),
    );
  }

  await interaction.reply({
    content: lines.join("\n"),
    ...(buttons.length > 0
      ? {
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
          ],
        }
      : {}),
    flags: MessageFlags.Ephemeral,
  });
}

const oauthDisabledMessage =
  "Subscription-token connections are currently disabled. Connect an Anthropic API key instead (`/connect llm`).";

function llmChooserMessage(
  current: string | null,
  oauthEnabled: boolean,
): {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
  flags: typeof MessageFlags.Ephemeral;
} {
  const status = current
    ? `Currently connected: **${providerTypeLabel(current)}**. Choose a provider to reconnect, or remove.`
    : "Choose how to connect your LLM. You'll be asked for credentials next — they're never posted to the channel.";

  // API key leads; the subscription-token path sits behind a kill switch.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("aw:llm:anthropic_api_key")
      .setLabel("Anthropic API key")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("aw:llm:claude_oauth")
      .setLabel(
        oauthEnabled
          ? "Claude subscription (Pro/Max)"
          : "Claude subscription (disabled)",
      )
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!oauthEnabled),
    new ButtonBuilder()
      .setCustomId("aw:llm:custom")
      .setLabel("Other provider")
      .setStyle(ButtonStyle.Secondary),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [row];
  if (current) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("aw:llm:remove")
          .setLabel("Remove credential")
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }

  return { content: status, components, flags: MessageFlags.Ephemeral };
}

function apiKeyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("aw:llm_modal:anthropic_api_key")
    .setTitle("Connect Anthropic API key")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("token")
          .setLabel("API key (starts with sk-ant-api…)")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(512)
          .setRequired(true),
      ),
    );
}

function oauthModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("aw:llm_modal:claude_oauth")
    .setTitle("Connect Claude subscription token")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("token")
          .setLabel("Run: claude setup-token  →  paste output here")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(512)
          .setRequired(true),
      ),
    );
}

function customModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("aw:llm_modal:custom")
    .setTitle("Connect custom provider")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("base_url")
          .setLabel("Base URL (e.g. https://api.example.com)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("token")
          .setLabel("API key / Bearer token")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(512)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("model")
          .setLabel("Model name (e.g. deepseek-coder)")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(128)
          .setRequired(true),
      ),
    );
}

function providerTypeLabel(type: string): string {
  switch (type) {
    case "anthropic_api_key":
      return "Anthropic API key";
    case "claude_oauth":
      return "Claude subscription";
    case "custom":
      return "custom provider";
    default:
      return type;
  }
}
