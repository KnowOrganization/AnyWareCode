/**
 * Model_Selector — admin `/model` command (Req 4, 5, 10).
 *
 * With no option it shows an ephemeral status (configured provider + effective
 * model + a "Change model" button), or instructs `/connect llm` when the guild
 * is unconfigured. A model option (or the change modal) sets the guild's
 * Selected_Model: the candidate is trimmed, rejected when empty/whitespace or
 * >256 chars, then validated against the configured provider via an
 * adapter-aware probe under a 10s timeout. A model-unavailable signal rejects
 * with "model is unavailable"; a timeout/auth/transport failure rejects with
 * "could not be validated". On success only `llmModel` is written — provider,
 * credential, base URL, and timestamp are untouched (Req 4.2) — and the
 * confirmation names the new model (Req 4.5). No tier/cap checks apply (Req 4.6).
 *
 * Credential material never appears in any response (Req 5, 9.5): the probe
 * swallows errors and the rejection copy is fixed, never interpolating the
 * token or response body.
 */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { eq } from "drizzle-orm";
import { schema } from "@anywarecode/db";
import type { BotContext } from "./interactions.js";
import { resolveLlmAuth, type LlmAuth } from "../llm/credentials.js";
import { effectiveModel } from "../llm/providers/defaults.js";
import { providerTypeLabel } from "./connect.js";

/** Hard ceiling on the change probe (Req 10.3): 10 seconds. */
const PROBE_TIMEOUT_MS = 10_000;
/** Max accepted model-identifier length after trimming (Req 5.6, 10.1). */
const MAX_MODEL_LEN = 256;

/** Three-state outcome of validating a candidate model against the provider. */
export type ModelProbeOutcome = "ok" | "unavailable" | "unvalidated";

/** Adapter-aware model probe, injectable for tests (Req 10.2, 10.3). */
export type ModelProbe = (
	auth: LlmAuth,
	model: string,
	deps?: { fetchFn?: typeof fetch; timeoutMs?: number },
) => Promise<ModelProbeOutcome>;

/**
 * Issue a single live probe for `model` against the credential's provider and
 * classify the result:
 *  - `400`/`404` whose body indicates an unknown/unavailable model → `unavailable`
 *  - `200` or a non-model `400` → `ok`
 *  - `401`/`403`, any other status, or abort/timeout/transport error → `unvalidated`
 * Errors are swallowed so no credential material can leak (Req 5, 9.5).
 */
export const probeModelAvailability: ModelProbe = async (auth, model, deps) => {
	const fetchFn = deps?.fetchFn ?? fetch;
	const timeoutMs = deps?.timeoutMs ?? PROBE_TIMEOUT_MS;
	const { adapterFor } = await import("../llm/providers/index.js");
	const adapter = adapterFor(auth);
	const { url, headers } = adapter.endpoint(auth);
	const body = JSON.stringify(adapter.buildProbeBody(model));

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchFn(url, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body,
			signal: controller.signal,
		});
		let parsed: unknown = null;
		try {
			parsed = await res.json();
		} catch {
			parsed = null;
		}
		if (adapter.isModelUnavailable(res.status, parsed)) return "unavailable";
		if (res.status === 200 || res.status === 400) return "ok";
		return "unvalidated";
	} catch {
		return "unvalidated";
	} finally {
		clearTimeout(timer);
	}
};

/** Minimal store seam over the guild's `llmModel` column, injected for tests. */
export interface ModelStore {
	setModel(model: string): Promise<void>;
}

/**
 * The testable core of a model change: validate the candidate, probe it, and on
 * success write only `llmModel`. Returns the persisted model or a rejection
 * reason (Req 4.2, 4.5, 5.6, 10.1–10.4).
 */
export async function applyModelChange(
	store: ModelStore,
	auth: LlmAuth,
	candidate: string,
	deps: { probe?: ModelProbe; fetchFn?: typeof fetch } = {},
): Promise<{ ok: true; model: string } | { ok: false; reason: string }> {
	const model = candidate.trim();
	if (!model) {
		return { ok: false, reason: "Model name is required." };
	}
	if (model.length > MAX_MODEL_LEN) {
		return {
			ok: false,
			reason: `Model name is too long (max ${MAX_MODEL_LEN} characters).`,
		};
	}
	const probe = deps.probe ?? probeModelAvailability;
	const outcome = await probe(auth, model, { fetchFn: deps.fetchFn });
	if (outcome === "unavailable") {
		return {
			ok: false,
			reason: "That model is unavailable on your configured provider.",
		};
	}
	if (outcome === "unvalidated") {
		return {
			ok: false,
			reason: "The model could not be validated. Try again.",
		};
	}
	await store.setModel(model);
	return { ok: true, model };
}

/** Optional injected deps for deterministic testing. */
export interface ModelCommandOpts {
	probe?: ModelProbe;
	fetchFn?: typeof fetch;
}

function changeModelButton(): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("aw:model:change")
			.setLabel("Change model")
			.setStyle(ButtonStyle.Primary),
	);
}

function changeModelModal(): ModalBuilder {
	return new ModalBuilder()
		.setCustomId("aw:model_modal")
		.setTitle("Change model")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("model")
					.setLabel("Model name")
					.setStyle(TextInputStyle.Short)
					.setMinLength(1)
					.setMaxLength(200)
					.setRequired(true),
			),
		);
}

function isAdmin(
	interaction:
		| ChatInputCommandInteraction
		| ButtonInteraction
		| ModalSubmitInteraction,
): boolean {
	return interaction.memberPermissions?.has("ManageGuild") ?? false;
}

function modelStoreFor(ctx: BotContext, guildId: string): ModelStore {
	return {
		setModel: async (model) => {
			await ctx.db
				.update(schema.guilds)
				.set({ llmModel: model })
				.where(eq(schema.guilds.id, guildId));
		},
	};
}

/** Handle the `/model` slash command (status, or a direct option change). */
export async function handleModelCommand(
	ctx: BotContext,
	interaction: ChatInputCommandInteraction,
	opts: ModelCommandOpts = {},
): Promise<void> {
	if (!isAdmin(interaction)) {
		await interaction.reply({
			content: "Admin permission required.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	const guildId = interaction.guildId;
	if (!guildId) {
		await interaction.reply({
			content: "This command can only be used in a server.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const resolved = await resolveLlmAuth(ctx.db, ctx.config, guildId);
	if (resolved.auth === null) {
		// Unconfigured / undecryptable → instruct reconnect (Req 4.3, 9.6).
		await interaction.reply({
			content: resolved.reason,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	const { auth } = resolved;

	const requested = interaction.options.getString("model");
	if (requested != null) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const result = await applyModelChange(
			modelStoreFor(ctx, guildId),
			auth,
			requested,
			{ probe: opts.probe, fetchFn: opts.fetchFn },
		);
		await interaction.editReply(
			result.ok
				? `✅ Model set to \`${result.model}\` (${providerTypeLabel(auth.type)}).`
				: `❌ ${result.reason}`,
		);
		return;
	}

	// No option → status + Change button (Req 4.1, 9.1, 9.2).
	const model = effectiveModel(
		auth.type,
		"model" in auth ? auth.model : null,
		ctx.config,
	);
	await interaction.reply({
		content: `🤖 Provider: **${providerTypeLabel(auth.type)}** — model \`${model}\`.`,
		components: [changeModelButton()],
		flags: MessageFlags.Ephemeral,
	});
}

/** Handle the "Change model" button → open the change modal. */
export async function handleModelButton(
	ctx: BotContext,
	interaction: ButtonInteraction,
): Promise<void> {
	if (!isAdmin(interaction)) {
		await interaction.reply({
			content: "Admin permission required.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	await interaction.showModal(changeModelModal());
}

/** Handle the change-model modal submit. */
export async function handleModelModal(
	ctx: BotContext,
	interaction: ModalSubmitInteraction,
	opts: ModelCommandOpts = {},
): Promise<void> {
	if (!isAdmin(interaction)) {
		await interaction.reply({
			content: "Admin permission required.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	const guildId = interaction.guildId;
	if (!guildId) return;
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const resolved = await resolveLlmAuth(ctx.db, ctx.config, guildId);
	if (resolved.auth === null) {
		await interaction.editReply(resolved.reason);
		return;
	}
	const candidate = interaction.fields.getTextInputValue("model");
	const result = await applyModelChange(
		modelStoreFor(ctx, guildId),
		resolved.auth,
		candidate,
		{ probe: opts.probe, fetchFn: opts.fetchFn },
	);
	await interaction.editReply(
		result.ok
			? `✅ Model set to \`${result.model}\` (${providerTypeLabel(resolved.auth.type)}).`
			: `❌ ${result.reason}`,
	);
}
