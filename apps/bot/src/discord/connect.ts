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
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@anywarecode/db";
import { isClaudeOauthEnabled } from "../flags.js";
import { log } from "../observability.js";
import { createInstallState } from "../github/install-state.js";
import {
	encryptCredential,
	validateLlmAuth,
	type LlmAuth,
} from "../llm/credentials.js";
import { defaultModelFor, effectiveModel } from "../llm/providers/defaults.js";
import { removeGuildInstallation } from "@anywarecode/db";
import { listInstallations } from "../github/installations.js";
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
	const linked = await listInstallations(ctx.db, guildId);

	const removeLogin = interaction.options.getString("remove")?.toLowerCase();
	if (removeLogin) {
		// Match by login, or by installation id — pre-multi-install rows may
		// carry an empty login and would otherwise be unremovable.
		const target = linked.find(
			(i) =>
				i.accountLogin.toLowerCase() === removeLogin ||
				String(i.installationId) === removeLogin,
		);
		if (!target) {
			await interaction.reply({
				content: `No linked installation for \`${removeLogin}\`. Linked: ${linked.map((i) => i.accountLogin).join(", ") || "none"}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await removeGuildInstallation(ctx.db, guildId, target.installationId);
		await interaction.reply(
			`🔌 Unlinked **${target.accountLogin}** — its channel bindings were removed. (Uninstalling the app on GitHub's side is separate.)`,
		);
		return;
	}

	const state = await createInstallState(
		ctx.db,
		ctx.config.STATE_SECRET,
		guildId,
		ctx.config.INSTALL_STATE_TTL_MINUTES,
	);
	await interaction.reply({
		content: [
			linked.length > 0
				? `Linked installations: ${linked.map((i) => `**${i.accountLogin || `#${i.installationId}`}**`).join(", ")}.`
				: "No GitHub installations linked yet.",
			`[Install on another account or org](${ctx.github.installUrl(state)}) — GitHub's picker offers your orgs. Unlink with \`/connect github remove:<login>\`.`,
		].join("\n"),
		flags: MessageFlags.Ephemeral,
	});
}

/** The five credential columns cleared on credential removal (Req 8.4). */
const LLM_FIELDS_CLEARED = {
	llmProviderType: null,
	llmCredentialEnc: null,
	llmBaseUrl: null,
	llmModel: null,
	llmCredentialSetAt: null,
} as const;

/** Minimal store seam over the guild's five credential columns, injected so the
 *  bounded-retry removal can be property-tested without a real DB (Req 8.4–8.6). */
export interface LlmCredStore {
	clear(): Promise<void>;
	read(): Promise<{
		llmProviderType: unknown;
		llmCredentialEnc: unknown;
		llmBaseUrl: unknown;
		llmModel: unknown;
		llmCredentialSetAt: unknown;
	} | null | undefined>;
}

/**
 * Clear all five LLM-credential columns, re-read, and retry the clear up to
 * `maxAttempts` total (4) while any field remains set (Req 8.4–8.6). Returns
 * whether the row ended fully cleared and how many attempts ran. On exhaustion
 * (`cleared:false`) the caller treats the guild as unconfigured.
 */
export async function clearLlmCredentialWithRetry(
	store: LlmCredStore,
	maxAttempts = 4,
): Promise<{ cleared: boolean; attempts: number }> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		await store.clear();
		const row = await store.read();
		const dirty =
			row != null &&
			(row.llmProviderType != null ||
				row.llmCredentialEnc != null ||
				row.llmBaseUrl != null ||
				row.llmModel != null ||
				row.llmCredentialSetAt != null);
		if (!dirty) return { cleared: true, attempts: attempt };
	}
	return { cleared: false, attempts: maxAttempts };
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
		const { cleared } = await clearLlmCredentialWithRetry({
			clear: async () => {
				await ctx.db
					.update(schema.guilds)
					.set(LLM_FIELDS_CLEARED)
					.where(eq(schema.guilds.id, guildId));
			},
			read: async () =>
				ctx.db.query.guilds.findFirst({
					where: eq(schema.guilds.id, guildId),
				}),
		});
		await interaction.reply({
			content: cleared
				? "LLM credential removed. Use `/connect llm` to reconnect."
				: "⚠️ Couldn't fully remove the LLM credential after several attempts. The guild is treated as unconfigured — run `/connect llm` to reconnect.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	if (action === "setup") {
		// "Connect LLM" button from welcome message — show chooser
		if (!interaction.guildId) return;
		const guild = await ensureGuild(ctx.db, interaction.guildId, ctx.config);
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
		openai: openaiModal,
		openrouter: openrouterModal,
	};
	const buildModal = modalBuilders[action];
	if (!buildModal) return;
	await interaction.showModal(buildModal());
}

export async function handleLlmModal(
	ctx: BotContext,
	interaction: ModalSubmitInteraction,
	providerType: string,
	now: () => Date = () => new Date(),
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
	} else if (providerType === "openai" || providerType === "openrouter") {
		const token = interaction.fields.getTextInputValue("token").trim();
		if (!token) {
			// Req 2.7 — whitespace-only key is rejected at submit, no persistence.
			await interaction.editReply("API key is required.");
			return;
		}
		const submitted = interaction.fields.getTextInputValue("model").trim();
		// Selected_Model = trimmed submission when non-empty, else Default_Model
		// (Req 1.6/2.6, 5.5). Never the prior model.
		const model = submitted || defaultModelFor(providerType, ctx.config);
		auth = { type: providerType, token, model };
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

	const enc = encryptCredential(
		ctx.config.CREDENTIAL_SECRET,
		guildId,
		auth.token,
	);
	await ensureGuild(ctx.db, guildId, ctx.config);
	// Selected_Model is persisted for every provider that carries one
	// (custom/openai/openrouter); the Anthropic legacy types store none. The
	// timestamp comes from the injectable clock (Req 1.4/2.4).
	const storedModel =
		auth.type === "custom" ||
		auth.type === "openai" ||
		auth.type === "openrouter"
			? auth.model
			: null;
	await ctx.db
		.update(schema.guilds)
		.set({
			llmProviderType: auth.type,
			llmCredentialEnc: enc,
			llmBaseUrl: auth.type === "custom" ? auth.baseUrl : null,
			llmModel: storedModel,
			llmCredentialSetAt: now(),
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

	const installations = await listInstallations(ctx.db, guildId);
	const githubStatus =
		installations.length > 0
			? `✅ GitHub connected: ${installations.map((i) => `**${i.accountLogin || `#${i.installationId}`}**`).join(", ")} (${installations.length} installation${installations.length > 1 ? "s" : ""})`
			: `❌ GitHub not connected — run \`/connect github\``;

	let llmStatus: string;
	if (guild.llmProviderType && guild.llmCredentialSetAt) {
		// Effective model = Selected_Model when set, else the provider Default_Model
		// (Req 9.1, 9.2). Never includes credential material (Req 9.5).
		const model = effectiveModel(
			guild.llmProviderType,
			guild.llmModel,
			ctx.config,
		);
		llmStatus = `✅ LLM connected (${providerTypeLabel(guild.llmProviderType)}, model \`${model}\`, set ${guild.llmCredentialSetAt.toDateString()})`;
	} else {
		llmStatus = `❌ LLM not connected — run \`/connect llm\` (you bring your own AI)`;
	}

	const codeCap = capState(guild, "code");
	const askCap = capState(guild, "ask");
	const askUsage = askCap.unlimited
		? `${askCap.used}/∞ questions`
		: `${askCap.used}/${askCap.cap} questions`;
	const usageStatus = `📊 Usage this month: ${codeCap.used}/${codeCap.cap} code tasks, ${askUsage}`;

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

	const rows: ActionRowBuilder<ButtonBuilder>[] = [];
	// Native Discord checkout when SKUs are configured (Premium Apps rail).
	const premiumButtons: ButtonBuilder[] = [];
	const subscribed = plan.status === "active";
	if (!subscribed && ctx.config.DISCORD_SKU_PRO) {
		premiumButtons.push(
			new ButtonBuilder()
				.setStyle(ButtonStyle.Premium)
				.setSKUId(ctx.config.DISCORD_SKU_PRO),
		);
	}
	if (!subscribed && ctx.config.DISCORD_SKU_STUDIO) {
		premiumButtons.push(
			new ButtonBuilder()
				.setStyle(ButtonStyle.Premium)
				.setSKUId(ctx.config.DISCORD_SKU_STUDIO),
		);
	}
	if (ctx.config.DISCORD_SKU_PACK) {
		premiumButtons.push(
			new ButtonBuilder()
				.setStyle(ButtonStyle.Premium)
				.setSKUId(ctx.config.DISCORD_SKU_PACK),
		);
	}
	if (premiumButtons.length > 0) {
		rows.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(...premiumButtons),
		);
	}
	const billingSecret = ctx.config.BILLING_BRIDGE_SECRET;
	if (ctx.config.WEB_URL) {
		const payRow = new ActionRowBuilder<ButtonBuilder>();
		// Upgrade links go to the no-login Razorpay pay-redirect (geo-detects currency).
		if (!subscribed) {
			payRow.addComponents(
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("Upgrade to Pro")
					.setURL(`${ctx.config.WEB_URL}/pay/${guildId}/sub?plan=pro`),
				new ButtonBuilder()
					.setStyle(ButtonStyle.Link)
					.setLabel("Upgrade to Studio")
					.setURL(`${ctx.config.WEB_URL}/pay/${guildId}/sub?plan=studio`),
			);
		}
		// Job Pack: bot-handled when we can sign attribution; else a plain link.
		payRow.addComponents(
			billingSecret
				? new ButtonBuilder()
						.setStyle(ButtonStyle.Secondary)
						.setCustomId("aw:billing:pack")
						.setLabel("Buy a Job Pack 🔋")
				: new ButtonBuilder()
						.setStyle(ButtonStyle.Link)
						.setLabel("Buy a Job Pack 🔋")
						.setURL(`${ctx.config.WEB_URL}/pay/${guildId}/pack`),
		);
		rows.push(payRow);
		// Cancel (Razorpay-managed subs only) needs the bot↔web bridge secret.
		if (subscribed && guild.subSource !== "discord" && billingSecret) {
			rows.push(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setStyle(ButtonStyle.Danger)
						.setCustomId("aw:billing:cancel")
						.setLabel("Cancel subscription"),
				),
			);
		}
	}

	await interaction.reply({
		content: lines.join("\n"),
		...(rows.length > 0 ? { components: rows } : {}),
		flags: MessageFlags.Ephemeral,
	});
}

/** Sign the Job-Pack attribution token the web `/pay/<g>/pack` route verifies
 * (same HMAC scheme as web `verifyPackToken`). */
function signPackToken(
	secret: string,
	payload: { g: string; u: string; n: string; e: number },
): string {
	const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
		"base64url",
	);
	const sig = createHmac("sha256", secret).update(body).digest("hex");
	return `${body}.${sig}`;
}

/** Handles the bot-side `/billing` buttons: Job Pack (any member) and Cancel
 * (manager-gated). Both bridge to the web (Razorpay lives there). */
export async function handleBillingButton(
	ctx: BotContext,
	interaction: ButtonInteraction,
	sub: "pack" | "cancel",
): Promise<void> {
	const guildId = interaction.guildId;
	if (!guildId) return;
	const secret = ctx.config.BILLING_BRIDGE_SECRET;
	const webUrl = ctx.config.WEB_URL;
	if (!secret || !webUrl) {
		await interaction.reply({
			content: "Billing isn't configured on this bot.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	if (sub === "pack") {
		const name =
			interaction.member && "displayName" in interaction.member
				? (interaction.member.displayName as string)
				: interaction.user.username;
		const token = signPackToken(secret, {
			g: guildId,
			u: interaction.user.id,
			n: name,
			e: Date.now() + 30 * 60_000,
		});
		await interaction.reply({
			content:
				"Add a Job Pack (50 code tasks) for the whole server — opens secure Razorpay checkout, and you get a public 🔋 credit.",
			components: [
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setStyle(ButtonStyle.Link)
						.setLabel("Continue to checkout 🔋")
						.setURL(`${webUrl}/pay/${guildId}/pack?t=${token}`),
				),
			],
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// cancel — manager only.
	if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
		await interaction.reply({
			content: "Only server managers can cancel the subscription.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	try {
		const res = await fetch(`${webUrl}/api/billing/cancel`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${secret}`,
			},
			body: JSON.stringify({ guildId }),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
			};
			await interaction.editReply(
				`Couldn't cancel: ${body.error ?? `error ${res.status}`}.`,
			);
			return;
		}
		await interaction.editReply(
			"Subscription set to cancel at the end of the current period — you keep access until then.",
		);
	} catch (err) {
		log.warn({ err }, "billing cancel call failed");
		await interaction.editReply(
			"Couldn't reach billing right now. Try again shortly.",
		);
	}
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
			.setCustomId("aw:llm:openai")
			.setLabel("OpenAI")
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId("aw:llm:openrouter")
			.setLabel("OpenRouter")
			.setStyle(ButtonStyle.Secondary),
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

function openaiModal(): ModalBuilder {
	return new ModalBuilder()
		.setCustomId("aw:llm_modal:openai")
		.setTitle("Connect OpenAI")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("token")
					.setLabel("API key (starts with sk-…)")
					.setStyle(TextInputStyle.Short)
					.setMinLength(1)
					.setMaxLength(512)
					.setRequired(true),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("model")
					.setLabel("Model (blank for default, e.g. gpt-4o-mini)")
					.setStyle(TextInputStyle.Short)
					.setMaxLength(256)
					.setRequired(false),
			),
		);
}

function openrouterModal(): ModalBuilder {
	return new ModalBuilder()
		.setCustomId("aw:llm_modal:openrouter")
		.setTitle("Connect OpenRouter")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("token")
					.setLabel("API key (starts with sk-or-…)")
					.setStyle(TextInputStyle.Short)
					.setMaxLength(512)
					.setRequired(true),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("model")
					.setLabel("Model (blank for default, e.g. openrouter/auto)")
					.setStyle(TextInputStyle.Short)
					.setMaxLength(200)
					.setRequired(false),
			),
		);
}

export function providerTypeLabel(type: string): string {
	switch (type) {
		case "anthropic_api_key":
			return "Anthropic API key";
		case "claude_oauth":
			return "Claude subscription";
		case "custom":
			return "custom provider";
		case "openai":
			return "OpenAI";
		case "openrouter":
			return "OpenRouter";
		default:
			return type;
	}
}
