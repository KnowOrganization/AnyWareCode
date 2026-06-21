/**
 * Tests for the Model_Selector `/model` command
 * (multi-provider-model-switching, tasks 8.3–8.7).
 *
 * The pure core `applyModelChange` is driven with an injected probe + store
 * (no network/DB); the command/modal handlers are driven with a mocked
 * `resolveLlmAuth` and fake interactions for the gating, unconfigured, and
 * confirmation cases.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type {
	ChatInputCommandInteraction,
	ModalSubmitInteraction,
} from "discord.js";
import type { BotContext } from "./interactions.js";
import type { LlmAuth } from "../llm/credentials.js";

vi.mock("../llm/credentials.js", async (orig) => ({
	...(await orig<typeof import("../llm/credentials.js")>()),
	resolveLlmAuth: vi.fn(),
}));

import { resolveLlmAuth } from "../llm/credentials.js";
import {
	applyModelChange,
	probeModelAvailability,
	handleModelCommand,
	handleModelModal,
	type ModelProbe,
	type ModelStore,
} from "./model.js";

const config = {
	OPENAI_DEFAULT_MODEL: "gpt-4o-mini",
	OPENROUTER_DEFAULT_MODEL: "openrouter/auto",
	DEFAULT_MODEL: "claude-sonnet-4-6",
} as unknown as BotContext["config"];

const OPENAI_AUTH: LlmAuth = { type: "openai", token: "sk-secret", model: "m" };

/** A store that records the single mutation `applyModelChange` is allowed. */
function recordingStore(): { store: ModelStore; written: string[] } {
	const written: string[] = [];
	return {
		store: { setModel: async (m) => void written.push(m) },
		written,
	};
}

const okProbe: ModelProbe = async () => "ok";

describe("applyModelChange — provider-scoped mutation (Property 6; Req 4.2,5.1-5.3)", () => {
	// Feature: multi-provider-model-switching, Property 6: Model switch is
	// provider-scoped and mutates only the Selected_Model.
	it("writes only the model and nothing else", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc
					.string({ minLength: 1, maxLength: 60 })
					.filter((s) => s.trim().length > 0 && s.trim().length <= 256),
				async (model) => {
					const { store, written } = recordingStore();
					const res = await applyModelChange(store, OPENAI_AUTH, model, {
						probe: okProbe,
					});
					expect(res.ok).toBe(true);
					// The only mutation is the trimmed model — the store seam exposes
					// no provider/credential/baseUrl/timestamp field to touch.
					expect(written).toEqual([model.trim()]);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("applyModelChange — confirmation names the model (Property 8; Req 4.5)", () => {
	// Feature: multi-provider-model-switching, Property 8: Confirmation names the
	// new model.
	it("returns the trimmed persisted model on success", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc
					.string({ minLength: 1, maxLength: 60 })
					.filter((s) => s.trim().length > 0 && s.trim().length <= 256)
					.map((s) => `  ${s}  `),
				async (padded) => {
					const { store } = recordingStore();
					const res = await applyModelChange(store, OPENAI_AUTH, padded, {
						probe: okProbe,
					});
					expect(res.ok && res.model).toBe(padded.trim());
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("applyModelChange — invalid model rejected (Property 9; Req 5.6,10.1,10.4)", () => {
	// Feature: multi-provider-model-switching, Property 9: Syntactically invalid
	// model is rejected and the previous selection retained.
	it("rejects empty/whitespace/>256 with a reason and no write", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(
					fc.constantFrom("", " ", "\t\n  "),
					fc
						.string({ minLength: 257, maxLength: 400 })
						.filter((s) => s.trim().length > 256),
				),
				async (bad) => {
					const { store, written } = recordingStore();
					// A probe that would accept anything — proves rejection is on the
					// syntactic check, before any probe.
					const res = await applyModelChange(store, OPENAI_AUTH, bad, {
						probe: okProbe,
					});
					expect(res.ok).toBe(false);
					if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
					expect(written).toEqual([]);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("applyModelChange — provider-reported unavailable (Property 10; Req 10.2)", () => {
	// Feature: multi-provider-model-switching, Property 10: Provider-reported
	// unavailable model is rejected with the unavailable reason.
	it("rejects with 'unavailable' and retains the previous model", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc
					.string({ minLength: 1, maxLength: 60 })
					.filter((s) => s.trim().length > 0 && s.trim().length <= 256),
				async (model) => {
					const { store, written } = recordingStore();
					const unavailableProbe: ModelProbe = async () => "unavailable";
					const res = await applyModelChange(store, OPENAI_AUTH, model, {
						probe: unavailableProbe,
					});
					expect(res.ok).toBe(false);
					if (!res.ok) expect(res.reason.toLowerCase()).toContain("unavailable");
					expect(written).toEqual([]);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("probeModelAvailability — 10s timeout (task 8.7; Req 10.3)", () => {
	it("returns 'unvalidated' when the probe never resolves before abort", async () => {
		// A fetch that only rejects when aborted; with a 1ms timeout the abort
		// fires and the outcome is 'unvalidated' (could not be validated).
		const hangingFetch = ((_url: string, init: { signal: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			})) as unknown as typeof fetch;
		const outcome = await probeModelAvailability(OPENAI_AUTH, "m", {
			fetchFn: hangingFetch,
			timeoutMs: 1,
		});
		expect(outcome).toBe("unvalidated");
	});
});

// --- Handler-level gating / unconfigured (task 8.7; Req 4.3, 4.4) ---

function makeSlash(opts: { admin: boolean; guildId?: string; model?: string }) {
	const reply = vi.fn(async (_p: unknown) => {});
	const editReply = vi.fn(async (_p: unknown) => {});
	const interaction = {
		memberPermissions: { has: (p: string) => opts.admin && p === "ManageGuild" },
		guildId: opts.guildId ?? "g1",
		options: { getString: (_n: string) => opts.model ?? null },
		reply,
		editReply,
		deferReply: vi.fn(async () => {}),
	} as unknown as ChatInputCommandInteraction;
	return { interaction, reply, editReply };
}

const ctx = { db: {}, config } as unknown as BotContext;

beforeEach(() => {
	vi.mocked(resolveLlmAuth).mockReset();
});

describe("/model handler gating + unconfigured (task 8.7)", () => {
	it("rejects a non-admin with no state change (Req 4.4)", async () => {
		const { interaction, reply } = makeSlash({ admin: false });
		await handleModelCommand(ctx, interaction);
		expect(resolveLlmAuth).not.toHaveBeenCalled();
		expect(reply.mock.calls[0]?.[0]).toMatchObject({
			content: expect.stringContaining("Admin"),
		});
	});

	it("instructs reconnect when unconfigured (Req 4.3)", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: null,
			reason: "No LLM connected. Admin: run `/connect llm`.",
		});
		const { interaction, reply } = makeSlash({ admin: true });
		await handleModelCommand(ctx, interaction);
		expect(reply.mock.calls[0]?.[0]).toMatchObject({
			content: expect.stringContaining("/connect llm"),
		});
	});

	it("names the new model on a successful option change (Req 4.5)", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: OPENAI_AUTH,
			source: "guild",
		});
		const db = {
			update: () => ({ set: () => ({ where: async () => {} }) }),
		};
		const localCtx = { db, config } as unknown as BotContext;
		const { interaction, editReply } = makeSlash({
			admin: true,
			model: "gpt-4o",
		});
		await handleModelCommand(localCtx, interaction, { probe: okProbe });
		expect(editReply.mock.calls[0]?.[0]).toContain("gpt-4o");
	});
});

describe("/model modal submit (task 8.7)", () => {
	function makeModalSub(opts: { admin: boolean; model: string }) {
		const editReply = vi.fn(async (_p: unknown) => {});
		const interaction = {
			memberPermissions: {
				has: (p: string) => opts.admin && p === "ManageGuild",
			},
			guildId: "g1",
			deferReply: vi.fn(async () => {}),
			editReply,
			fields: { getTextInputValue: (_k: string) => opts.model },
		} as unknown as ModalSubmitInteraction;
		return { interaction, editReply };
	}

	it("persists and confirms via the modal on success", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: OPENAI_AUTH,
			source: "guild",
		});
		const written: string[] = [];
		const db = {
			update: () => ({
				set: (p: { llmModel: string }) => ({
					where: async () => void written.push(p.llmModel),
				}),
			}),
		};
		const localCtx = { db, config } as unknown as BotContext;
		const { interaction, editReply } = makeModalSub({
			admin: true,
			model: "gpt-4o-mini",
		});
		await handleModelModal(localCtx, interaction, { probe: okProbe });
		expect(written).toEqual(["gpt-4o-mini"]);
		expect(editReply.mock.calls[0]?.[0]).toContain("gpt-4o-mini");
	});
});
