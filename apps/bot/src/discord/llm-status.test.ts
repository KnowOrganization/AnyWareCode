/**
 * Unit + property tests for the admin `/llm-status` command handler (Req 11).
 *
 * `resolveLlmAuth` is mocked so no DB/crypto is touched, and `probeModel` is
 * injected via `opts.probe` so no network I/O occurs. The injectable `nowMs`
 * clock exercises the 60s per-guild probe cache deterministically.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fc from "fast-check";
import type { ChatInputCommandInteraction } from "discord.js";
import type { BotContext } from "./interactions.js";
import type { LlmCallResult } from "../llm/failures.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { handleLlmStatusCommand, clearProbeCache } from "./llm-status.js";

vi.mock("../llm/credentials.js", () => ({
	resolveLlmAuth: vi.fn(),
}));

const config = {
	CHAT_MODEL: "claude-haiku-4-5",
	DEFAULT_MODEL: "claude-sonnet-4-6",
	CODE_MODEL: "claude-opus-4-8",
	RETRY_MAX_DELAY_SECONDS: 5,
};

const ctx = { db: {}, config } as unknown as BotContext;

/** Build a fake slash-command interaction whose `reply` is a spy. */
function makeInteraction(opts: { admin: boolean; guildId?: string }) {
	const reply = vi.fn(async (_payload: { content?: string }) => {});
	return {
		interaction: {
			memberPermissions: {
				has: (p: string) => opts.admin && p === "ManageGuild",
			},
			guildId: opts.guildId ?? "g1",
			reply,
		} as unknown as ChatInputCommandInteraction,
		reply,
	};
}

/** A success result for every probed tier. */
function okResult(): LlmCallResult {
	return { ok: true, body: {} };
}

beforeEach(() => {
	clearProbeCache();
	vi.mocked(resolveLlmAuth).mockResolvedValue({
		auth: { type: "claude_oauth", token: "oauth-secret-xyz" },
		source: "guild",
	});
});

describe("handleLlmStatusCommand", () => {
	it("renders the connected provider type (Req 11.1)", async () => {
		const { interaction, reply } = makeInteraction({ admin: true });
		const probe = vi.fn(async () => okResult());

		await handleLlmStatusCommand(ctx, interaction, { probe });

		const content = reply.mock.calls[0]?.[0]?.content as string;
		expect(content).toContain("claude_oauth");
	});

	it("probes each tier with a 10s timeout and renders per-tier status (Req 11.2)", async () => {
		const { interaction, reply } = makeInteraction({ admin: true });
		const calls: { model: string; timeoutMs: number }[] = [];
		const probe = vi.fn(
			async (args: { model: string; timeoutMs: number }) => {
				calls.push({ model: args.model, timeoutMs: args.timeoutMs });
				return okResult();
			},
		);

		await handleLlmStatusCommand(ctx, interaction, { probe });

		// Exactly one probe per configured tier, each with the 10s timeout.
		expect(calls).toHaveLength(3);
		for (const c of calls) {
			expect(c.timeoutMs).toBe(10000);
		}
		expect(calls.map((c) => c.model)).toEqual([
			config.CHAT_MODEL,
			config.DEFAULT_MODEL,
			config.CODE_MODEL,
		]);

		// Each tier is rendered with a status marker.
		const content = reply.mock.calls[0]?.[0]?.content as string;
		expect(content).toContain("chat");
		expect(content).toContain("default");
		expect(content).toContain("code");
		// Three success markers — one per tier.
		expect(content.match(/✅ success/g)).toHaveLength(3);
	});

	it("renders the reset time for a rate-limited tier (Req 11.3)", async () => {
		const { interaction, reply } = makeInteraction({ admin: true });
		const resetTimeMs = 1_700_000_000_000; // known epoch ms
		const epoch = Math.floor(resetTimeMs / 1000);
		const probe = vi.fn(
			async (args: { model: string }): Promise<LlmCallResult> => {
				if (args.model === config.DEFAULT_MODEL) {
					return {
						ok: false,
						failure: {
							mode: "rate_limited",
							httpStatus: 429,
							// Large retry-after so callWithRetry skips the retry (RETRY_MAX_DELAY=5s).
							rateLimitInfo: { resetTimeMs, retryAfterMs: 999_000 },
						},
					};
				}
				return okResult();
			},
		);

		await handleLlmStatusCommand(ctx, interaction, { probe });

		const content = reply.mock.calls[0]?.[0]?.content as string;
		expect(content).toContain("<t:");
		expect(content).toContain(`<t:${epoch}:R>`);
	});

	it("denies a non-admin with zero probes (Req 11.4)", async () => {
		const { interaction, reply } = makeInteraction({ admin: false });
		const probe = vi.fn(async () => okResult());

		await handleLlmStatusCommand(ctx, interaction, { probe });

		const content = reply.mock.calls[0]?.[0]?.content as string;
		expect(content).toBe("Admin permission required");
		expect(probe).not.toHaveBeenCalled();
	});

	it("serves the cache within 60s without re-probing (Req 11.5)", async () => {
		const probe = vi.fn(async () => okResult());

		// First call at t=1000 — fresh probes for all three tiers.
		const first = makeInteraction({ admin: true });
		await handleLlmStatusCommand(ctx, first.interaction, {
			probe,
			nowMs: () => 1000,
		});
		expect(probe).toHaveBeenCalledTimes(3);

		// Second call at t=60000 (59s later, < 60s) — served from cache, no probes.
		const second = makeInteraction({ admin: true });
		await handleLlmStatusCommand(ctx, second.interaction, {
			probe,
			nowMs: () => 1000 + 59_000,
		});
		expect(probe).toHaveBeenCalledTimes(3); // unchanged
		expect(second.reply).toHaveBeenCalledTimes(1); // a reply is still sent

		// Third call at t=62000 (61s later, > 60s) — cache expired, re-probes.
		const third = makeInteraction({ admin: true });
		await handleLlmStatusCommand(ctx, third.interaction, {
			probe,
			nowMs: () => 1000 + 61_000,
		});
		expect(probe).toHaveBeenCalledTimes(6);
	});

	// Feature: llm-rate-limit-resilience, Property 16: Secret redaction invariant
	// (report half) — the rendered /llm-status report never contains the
	// credential token as a substring. Validates: Requirements 11.6
	it("Property 16: report never contains the credential token (Req 11.6)", async () => {
		// Realistic, non-trivial secret tokens so the substring check is meaningful.
		const tokenArb = fc.oneof(
			fc
				.hexaString({ minLength: 24, maxLength: 64 })
				.map((s) => `sk-ant-${s}`),
			fc
				.hexaString({ minLength: 24, maxLength: 64 })
				.map((s) => `Bearer ${s}`),
		);

		// Assorted probe outcomes — one per tier.
		const resultArb: fc.Arbitrary<LlmCallResult> = fc.oneof(
			fc.constant<LlmCallResult>({ ok: true, body: {} }),
			fc
				.option(
					fc.integer({ min: 1_600_000_000_000, max: 1_900_000_000_000 }),
					{
						nil: null,
					},
				)
				.map<LlmCallResult>((resetTimeMs) => ({
					ok: false,
					failure: {
						mode: "rate_limited",
						httpStatus: 429,
						// > RETRY_MAX_DELAY_SECONDS*1000 so callWithRetry skips the retry.
						rateLimitInfo: { resetTimeMs, retryAfterMs: 999_000 },
					},
				})),
			fc
				.constantFrom(
					"auth_failed",
					"overloaded",
					"model_error",
					"network_error",
				)
				.map<LlmCallResult>((mode) => ({
					ok: false,
					failure: { mode: mode as "auth_failed", httpStatus: 500 },
				})),
		);

		await fc.assert(
			fc.asyncProperty(
				tokenArb,
				fc.array(resultArb, { minLength: 3, maxLength: 3 }),
				async (secret, results) => {
					// Clear the per-guild cache so probes actually run each iteration.
					clearProbeCache();
					vi.mocked(resolveLlmAuth).mockResolvedValue({
						auth: { type: "claude_oauth", token: secret },
						source: "guild",
					});

					let i = 0;
					const probe = vi.fn(
						async () => results[i++ % results.length] as LlmCallResult,
					);

					const { interaction, reply } = makeInteraction({ admin: true });
					await handleLlmStatusCommand(ctx, interaction, { probe });

					const content = reply.mock.calls[0]?.[0]?.content as string;
					expect(content).not.toContain(secret);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("status rendering — provider + effective model (Req 9.1, 9.2, 9.6)", () => {
	it("shows the effective Default_Model for a provider with no Selected_Model", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: { type: "openai", token: "sk-x", model: "gpt-4o-mini" },
			source: "guild",
		});
		const { interaction, reply } = makeInteraction({ admin: true });
		await handleLlmStatusCommand(ctx, interaction, {
			probe: vi.fn(async () => okResult()),
		});
		const content = reply.mock.calls[0]?.[0]?.content as string;
		expect(content).toContain("openai");
		expect(content).toContain("gpt-4o-mini");
	});

	it("probes only the guild's effective model for pin-own-model providers (not claude tiers)", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: {
				type: "openrouter",
				token: "sk-or",
				model: "anthropic/claude-3.5-sonnet",
			},
			source: "guild",
		});
		const probed: string[] = [];
		const probe = vi.fn(async (args: { model: string }) => {
			probed.push(args.model);
			return okResult();
		});
		const { interaction } = makeInteraction({ admin: true });
		await handleLlmStatusCommand(ctx, interaction, { probe });
		expect(probed).toEqual(["anthropic/claude-3.5-sonnet"]);
		expect(probed).not.toContain(config.CHAT_MODEL);
	});

	it("reports the retrieval failure / reconnect path when the credential is unreadable (Req 9.6)", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: null,
			reason: "Stored credential unreadable — admin must run `/connect llm` again.",
		});
		const { interaction, reply } = makeInteraction({ admin: true });
		await handleLlmStatusCommand(ctx, interaction, {
			probe: vi.fn(async () => okResult()),
		});
		const content = reply.mock.calls[0]?.[0]?.content as string;
		expect(content).toContain("/connect llm");
	});
});
