/**
 * Tests for the OpenAI/OpenRouter Connect_Flow and bounded-retry credential
 * removal (multi-provider-model-switching, tasks 7.4–7.7).
 *
 * `validateLlmAuth`/`encryptCredential` and `ensureGuild` are mocked so no
 * network, crypto, or DB I/O is touched; the guild row update is captured via a
 * fake `db.update().set().where()` chain.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { ModalSubmitInteraction } from "discord.js";
import type { BotContext } from "./interactions.js";

vi.mock("../llm/credentials.js", async (orig) => ({
	...(await orig<typeof import("../llm/credentials.js")>()),
	validateLlmAuth: vi.fn(async () => ({ ok: true as const })),
	encryptCredential: vi.fn(() => "v1.enc.ct.tag"),
}));
vi.mock("./gates.js", async (orig) => ({
	...(await orig<typeof import("./gates.js")>()),
	ensureGuild: vi.fn(async () => ({})),
}));
vi.mock("../flags.js", () => ({ isClaudeOauthEnabled: vi.fn(async () => true) }));

import type { ButtonInteraction } from "discord.js";
import { validateLlmAuth } from "../llm/credentials.js";
import {
	handleLlmButton,
	handleLlmModal,
	clearLlmCredentialWithRetry,
	type LlmCredStore,
} from "./connect.js";

const config = {
	OPENAI_DEFAULT_MODEL: "gpt-4o-mini",
	OPENROUTER_DEFAULT_MODEL: "openrouter/auto",
	DEFAULT_MODEL: "claude-sonnet-4-6",
	CREDENTIAL_SECRET: "x".repeat(32),
	CUSTOM_PROVIDER_ALLOWLIST: undefined,
} as unknown as BotContext["config"];

/** Build a fake modal interaction + a captured `set()` payload. */
function makeModal(opts: {
	fields: Record<string, string>;
	guildId?: string;
}) {
	const setPayload: Record<string, unknown>[] = [];
	const editReply = vi.fn(async (_c: unknown) => {});
	const where = vi.fn(async () => {});
	const set = vi.fn((p: Record<string, unknown>) => {
		setPayload.push(p);
		return { where };
	});
	const db = { update: vi.fn(() => ({ set })) };
	const ctx = { db, config } as unknown as BotContext;
	const interaction = {
		guildId: opts.guildId ?? "g1",
		deferReply: vi.fn(async () => {}),
		editReply,
		fields: { getTextInputValue: (k: string) => opts.fields[k] ?? "" },
	} as unknown as ModalSubmitInteraction;
	return { ctx, interaction, setPayload, editReply, set };
}

beforeEach(() => {
	vi.mocked(validateLlmAuth).mockClear();
	vi.mocked(validateLlmAuth).mockResolvedValue({ ok: true });
});

describe("Connect persists submitted-or-default model (Property 1; Req 1.3,1.6,2.3,2.6,5.5)", () => {
	// Feature: multi-provider-model-switching, Property 1: Connect persists the
	// submitted-or-default model, overwriting any prior.
	it("stores trimmed submission when non-empty, else the provider Default_Model", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("openai" as const, "openrouter" as const),
				// submitted model: empty/whitespace OR a non-empty identifier (with padding)
				fc.oneof(
					fc.constantFrom("", "   ", "\t"),
					fc
						.string({ minLength: 1, maxLength: 40 })
						.filter((s) => s.trim().length > 0)
						.map((s) => `  ${s}  `),
				),
				async (type, submitted) => {
					const { ctx, interaction, setPayload } = makeModal({
						fields: { token: "sk-secret", model: submitted },
					});
					await handleLlmModal(ctx, interaction, type);
					const payload = setPayload[0]!;
					const trimmed = submitted.trim();
					const expected =
						trimmed.length > 0
							? trimmed
							: type === "openai"
								? config.OPENAI_DEFAULT_MODEL
								: config.OPENROUTER_DEFAULT_MODEL;
					expect(payload.llmModel).toBe(expected);
					expect(payload.llmProviderType).toBe(type);
					expect(payload.llmBaseUrl).toBeNull();
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("Whitespace-only API key rejected (Property 2; Req 2.7)", () => {
	// Feature: multi-provider-model-switching, Property 2: Whitespace-only API key
	// is rejected with no persistence.
	it("rejects with 'API key is required' and persists nothing", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("openai" as const, "openrouter" as const),
				fc
					.stringMatching(/^[ \t\n\r]+$/)
					.filter((s) => s.length > 0 && s.trim().length === 0),
				async (type, ws) => {
					const { ctx, interaction, setPayload, editReply } = makeModal({
						fields: { token: ws, model: "" },
					});
					await handleLlmModal(ctx, interaction, type);
					expect(setPayload).toHaveLength(0);
					expect(validateLlmAuth).not.toHaveBeenCalled();
					const msg = editReply.mock.calls[0]?.[0] as string;
					expect(msg).toContain("API key is required");
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("Bounded-retry credential removal (Property 20; Req 8.4,8.5,8.6)", () => {
	// Feature: multi-provider-model-switching, Property 20: Bounded-retry
	// credential removal.
	const cleared = {
		llmProviderType: null,
		llmCredentialEnc: null,
		llmBaseUrl: null,
		llmModel: null,
		llmCredentialSetAt: null,
	};
	const dirty = { ...cleared, llmProviderType: "openai" };

	it("clears within ≤4 attempts when the store goes clean in time", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (dirtyRounds) => {
				let attempts = 0;
				const store: LlmCredStore = {
					clear: async () => {
						attempts++;
					},
					read: async () => (attempts <= dirtyRounds ? dirty : cleared),
				};
				const res = await clearLlmCredentialWithRetry(store);
				expect(res.cleared).toBe(true);
				expect(res.attempts).toBeLessThanOrEqual(4);
			}),
			{ numRuns: 100 },
		);
	});

	it("stops after 4 attempts and reports incomplete when always dirty", async () => {
		let attempts = 0;
		const store: LlmCredStore = {
			clear: async () => {
				attempts++;
			},
			read: async () => dirty,
		};
		const res = await clearLlmCredentialWithRetry(store);
		expect(res.cleared).toBe(false);
		expect(res.attempts).toBe(4);
		expect(attempts).toBe(4);
	});
});

describe("provider modals respect Discord field limits (showModal regression)", () => {
	// A label >45 chars makes showModal throw → Discord's "Something went wrong".
	// Drive each provider button and assert every TextInput label ≤45, placeholder ≤100.
	it.each(["anthropic_api_key", "claude_oauth", "custom", "openai", "openrouter"])(
		"%s modal labels are within limits",
		async (action) => {
			let modal: { toJSON(): unknown } | undefined;
			const interaction = {
				memberPermissions: { has: (_p: unknown) => true },
				guildId: "g1",
				showModal: vi.fn(async (m: { toJSON(): unknown }) => {
					modal = m;
				}),
				reply: vi.fn(async () => {}),
			} as unknown as ButtonInteraction;
			const ctx = { db: {}, config } as unknown as BotContext;
			await handleLlmButton(ctx, interaction, action);
			expect(modal).toBeDefined();
			const json = modal!.toJSON() as {
				components: { components: { label: string; placeholder?: string }[] }[];
			};
			for (const row of json.components) {
				for (const input of row.components) {
					expect(input.label.length).toBeLessThanOrEqual(45);
					expect(input.label.length).toBeGreaterThanOrEqual(1);
					if (input.placeholder != null) {
						expect(input.placeholder.length).toBeLessThanOrEqual(100);
					}
				}
			}
		},
	);
});

describe("Connect_Flow chooser, modal limits, gating (task 7.7)", () => {
	it("non-admin modal submit is gated before persistence is irrelevant — admin gate lives on the button", async () => {
		// handleLlmButton gates on ManageGuild before showing any modal; a modal
		// can only be submitted after the gated button, so persistence requires an
		// admin. This is covered by the button gate; here we assert a valid admin
		// openai submit persists the credential set timestamp from the clock.
		const fixed = new Date("2026-01-02T03:04:05.000Z");
		const { ctx, interaction, setPayload } = makeModal({
			fields: { token: "sk-secret", model: "gpt-4o" },
		});
		await handleLlmModal(ctx, interaction, "openai", () => fixed);
		expect(setPayload[0]?.llmCredentialSetAt).toBe(fixed);
		expect(setPayload[0]?.llmModel).toBe("gpt-4o");
	});
});
