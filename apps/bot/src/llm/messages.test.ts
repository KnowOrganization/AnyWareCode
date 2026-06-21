import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FailureMode, LlmFailure, RateLimitInfo } from "./failures.js";
import {
	buildChatFailureMessage,
	buildProviderUnavailableMessage,
	buildTaskFailureMessage,
	formatResetTime,
	isPreflightOrTranslatorFailure,
	openAiCompatibleProviderName,
	type MessageContext,
} from "./messages.js";

/**
 * Property-based tests for the pure message-builder (Req 3, 4, 5, 7).
 *
 * The builders are pure string functions, so every property exercises them
 * directly against generated `MessageContext` values — including adversarial
 * inputs that try to smuggle Discord mention tokens into the rendered text.
 * Each property runs at least 100 iterations.
 */

const ALL_MODES: FailureMode[] = [
	"rate_limited",
	"auth_failed",
	"overloaded",
	"model_error",
	"network_error",
];

const NON_RATE_MODES: Exclude<FailureMode, "rate_limited">[] = [
	"auth_failed",
	"overloaded",
	"model_error",
	"network_error",
];

const PROVIDER_TYPES: MessageContext["providerType"][] = [
	"anthropic_api_key",
	"claude_oauth",
	"custom",
	"unknown",
];

/** Reset_Time is either unknown (null) or a non-negative epoch-ms instant. */
const resetTimeArb: fc.Arbitrary<number | null> = fc.option(
	fc.integer({ min: 0, max: 4_102_444_800_000 }), // up to ~year 2100
	{ nil: null },
);

/** Rate-limit recovery metadata, including an optional reset time and status. */
const rateLimitInfoArb: fc.Arbitrary<RateLimitInfo> = fc.record({
	resetTimeMs: resetTimeArb,
	retryAfterMs: fc.option(fc.integer({ min: 0, max: 86_400_000 }), {
		nil: null,
	}),
	status: fc.option(fc.string(), { nil: undefined }),
});

/** A classified failure for any of the five modes (rate_limited carries info). */
const failureArb: fc.Arbitrary<LlmFailure> = fc
	.constantFrom<FailureMode>(...ALL_MODES)
	.chain((mode) => {
		if (mode === "rate_limited") {
			return rateLimitInfoArb.map(
				(rateLimitInfo): LlmFailure => ({
					mode,
					httpStatus: 429,
					rateLimitInfo,
				}),
			);
		}
		return fc.constant<LlmFailure>({ mode });
	});

const providerTypeArb: fc.Arbitrary<MessageContext["providerType"]> =
	fc.constantFrom(...PROVIDER_TYPES);

/** Discord mention tokens that MUST never survive as active syntax. */
const mentionTokenArb = fc.constantFrom(
	"@everyone",
	"@here",
	"<@123>",
	"<@!123>",
	"<@&123>",
);

/**
 * Arbitrary text that injects one or more mention tokens around random text,
 * used to populate provider/status/custom-model fields adversarially.
 */
const adversarialTextArb: fc.Arbitrary<string> = fc
	.tuple(fc.string(), fc.array(mentionTokenArb, { maxLength: 4 }), fc.string())
	.map(([a, tokens, b]) => `${a}${tokens.join(" ")}${b}`);

/** Detects any active (un-neutralized) Discord mention token in a string. */
function hasActiveMention(msg: string): boolean {
	if (msg.includes("@everyone")) return true;
	if (msg.includes("@here")) return true;
	if (/<@\d/.test(msg)) return true; // user mention <@123>
	if (/<@!/.test(msg)) return true; // user mention <@!123>
	if (/<@&/.test(msg)) return true; // role mention <@&123>
	return false;
}

/** Known Anthropic tier model identifiers that must never name in `custom`. */
const ANTHROPIC_TIER_IDS = ["claude-sonnet", "claude-opus", "claude-haiku"];

describe("message-builder — properties", () => {
	// Feature: llm-rate-limit-resilience, Property 7: Mention-safety invariant
	// for all user messages — for any failure mode, provider type, custom model
	// name, and rate-limit status string (including adversarial inputs that
	// embed @everyone/@here/<@123>/<@&123>), both builders return a string with
	// no active mention syntax (each dangerous token is broken by \u200b).
	// Validates: Requirements 3.4, 4.6, 5.8
	it("Property 7: neither builder ever returns an active mention token", () => {
		fc.assert(
			fc.property(
				failureArb,
				providerTypeArb,
				adversarialTextArb,
				(failure, providerType, customModelName) => {
					const ctx: MessageContext = {
						failure,
						providerType,
						customModelName,
					};
					const chat = buildChatFailureMessage(ctx);
					const task = buildTaskFailureMessage(ctx);
					expect(hasActiveMention(chat)).toBe(false);
					expect(hasActiveMention(task)).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 8: Truncation bound with
	// statement preservation — every built message is at most 2000 chars; when
	// rate_limited, the truncated message still contains the usage/rate-limit
	// statement and, when a Reset_Time is present, its rendered timestamp token.
	// A long custom-model name (rendered into the provider suffix) is used to
	// force truncation past the 2000-char Discord limit.
	// Validates: Requirements 3.6
	it("Property 8: messages stay within 2000 chars and preserve the rate-limit statement", () => {
		// Custom-model names that range from short to far beyond the 2000 budget.
		const longNameArb = fc.string({ minLength: 0, maxLength: 3000 });
		fc.assert(
			fc.property(
				failureArb,
				providerTypeArb,
				longNameArb,
				(failure, providerType, customModelName) => {
					const ctx: MessageContext = {
						failure,
						providerType,
						customModelName,
					};
					for (const msg of [
						buildChatFailureMessage(ctx),
						buildTaskFailureMessage(ctx),
					]) {
						expect(msg.length).toBeLessThanOrEqual(2000);
						if (failure.mode === "rate_limited") {
							expect(msg).toContain("hit its usage or rate limit");
							if (failure.rateLimitInfo?.resetTimeMs != null) {
								expect(msg).toContain("<t:");
							}
						}
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 9: Chat-path rate-limit
	// message content — states the credential hit its usage/rate limit; with a
	// Reset_Time it includes BOTH <t:EPOCH:F> and <t:EPOCH:R> for the correct
	// epoch; without one it states recovery is unknown and contains no <t: token.
	// Validates: Requirements 3.1, 3.2, 3.3
	it("Property 9: chat rate-limit message renders both timestamp tokens or an unknown-recovery notice", () => {
		fc.assert(
			fc.property(
				rateLimitInfoArb,
				providerTypeArb,
				(rateLimitInfo, providerType) => {
					const msg = buildChatFailureMessage({
						failure: {
							mode: "rate_limited",
							httpStatus: 429,
							rateLimitInfo,
						},
						providerType,
						customModelName: null,
					});
					expect(msg).toContain("hit its usage or rate limit");
					if (rateLimitInfo.resetTimeMs != null) {
						const epoch = Math.floor(rateLimitInfo.resetTimeMs / 1000);
						expect(msg).toContain(`<t:${epoch}:F>`);
						expect(msg).toContain(`<t:${epoch}:R>`);
					} else {
						expect(msg.toLowerCase()).toContain(
							"recovery time is unknown",
						);
						expect(msg).toContain("usage window resets");
						expect(msg).not.toContain("<t:");
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 10: Chat-path failure message
	// content per mode — for any non-success mode, buildChatFailureMessage
	// returns exactly one non-empty string whose content matches that mode.
	// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
	it("Property 10: chat failure message content matches the mode", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...NON_RATE_MODES),
				providerTypeArb,
				(mode, providerType) => {
					const msg = buildChatFailureMessage({
						failure: { mode },
						providerType,
						customModelName: null,
					});
					expect(typeof msg).toBe("string");
					expect(msg.length).toBeGreaterThan(0);
					switch (mode) {
						case "auth_failed":
							expect(msg).toContain("/connect llm");
							break;
						case "overloaded":
							expect(msg).toContain("overloaded");
							expect(msg).toContain("30 seconds");
							break;
						case "model_error":
							expect(msg).toContain("could not be processed");
							expect(msg).toContain("unlikely to succeed");
							break;
						case "network_error":
							expect(msg).toContain("could not be reached");
							expect(msg).toContain("30 seconds");
							break;
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 11: Task-path failure message
	// content per mode — for any non-success mode, buildTaskFailureMessage
	// returns exactly one non-empty string matching that mode (rate_limited
	// includes the absolute <t:EPOCH:F> token when a Reset_Time is available,
	// otherwise an unknown-recovery notice).
	// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
	it("Property 11: task failure message content matches the mode", () => {
		fc.assert(
			fc.property(failureArb, providerTypeArb, (failure, providerType) => {
				const msg = buildTaskFailureMessage({
					failure,
					providerType,
					customModelName: null,
				});
				expect(typeof msg).toBe("string");
				expect(msg.length).toBeGreaterThan(0);
				switch (failure.mode) {
					case "rate_limited": {
						expect(msg).toContain("hit its usage or rate limit");
						expect(msg).toContain("required model");
						if (failure.rateLimitInfo?.resetTimeMs != null) {
							const epoch = Math.floor(
								failure.rateLimitInfo.resetTimeMs / 1000,
							);
							expect(msg).toContain(`<t:${epoch}:F>`);
						} else {
							expect(msg.toLowerCase()).toContain(
								"recovery time is unknown",
							);
						}
						break;
					}
					case "auth_failed":
						expect(msg).toContain("invalid");
						expect(msg).toContain("/connect llm");
						break;
					case "overloaded":
						expect(msg).toContain("overloaded");
						expect(msg).toContain("retry");
						break;
					case "network_error":
						expect(msg).toContain("network");
						expect(msg).toContain("retry");
						break;
					case "model_error":
						expect(msg).toContain("could not process");
						expect(msg).toContain("unlikely to succeed");
						break;
				}
			}),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 12: Provider-type-aware
	// messaging — claude_oauth rate-limit messages carry the subscription note;
	// anthropic_api_key rate-limit messages exclude subscription text; custom
	// references the configured model (or generic when unset) and never names an
	// Anthropic tier; unknown omits provider/subscription specifics.
	// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
	it("Property 12: messages reflect the connected provider type", () => {
		// Custom-model names that never themselves contain an Anthropic tier id.
		const safeCustomNameArb = fc.constantFrom(
			"my-model",
			"local-llama",
			"gpt-4o-mini",
			"mistral-large",
			"internal-model-v2",
		);
		fc.assert(
			fc.property(
				providerTypeArb,
				failureArb,
				fc.option(safeCustomNameArb, { nil: null }),
				(providerType, failure, customModelName) => {
					for (const build of [
						buildChatFailureMessage,
						buildTaskFailureMessage,
					]) {
						const msg = build({ failure, providerType, customModelName });
						const lower = msg.toLowerCase();

						if (providerType === "claude_oauth") {
							if (failure.mode === "rate_limited") {
								expect(lower).toContain("subscription");
								expect(lower).toContain("lighter");
							}
						} else if (providerType === "anthropic_api_key") {
							if (failure.mode === "rate_limited") {
								expect(lower).not.toContain("subscription");
							}
						} else if (providerType === "custom") {
							for (const tier of ANTHROPIC_TIER_IDS) {
								expect(lower).not.toContain(tier);
							}
							if (customModelName) {
								expect(msg).toContain(customModelName);
							}
						} else {
							// "unknown" — no provider/subscription specifics.
							expect(lower).not.toContain("subscription");
						}
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("formatResetTime", () => {
	it("renders Discord absolute and relative tokens for the epoch seconds", () => {
		const { absolute, relative } = formatResetTime(1_700_000_000_500);
		expect(absolute).toBe("<t:1700000000:F>");
		expect(relative).toBe("<t:1700000000:R>");
	});
});

describe("OpenAI-compatible provider clear-failure copy (Req 7.3, 7.4)", () => {
	it("names the configured provider type and never another provider/model", () => {
		const openai = buildProviderUnavailableMessage("openai");
		expect(openai).toContain("OpenAI");
		expect(openai).not.toContain("OpenRouter");
		expect(openai).not.toContain("Anthropic");

		const openrouter = buildProviderUnavailableMessage("openrouter");
		expect(openrouter).toContain("OpenRouter");
		expect(openrouter).not.toContain("Anthropic");
	});

	it("states the task could not run and is mention-safe", () => {
		for (const type of ["openai", "openrouter"] as const) {
			const msg = buildProviderUnavailableMessage(type);
			expect(msg.toLowerCase()).toContain("couldn't run this task");
			// No active mention tokens leak through.
			expect(msg).not.toMatch(/@everyone|@here/);
			expect(msg.length).toBeLessThanOrEqual(2000);
		}
	});

	it("maps provider types to proper-cased names", () => {
		expect(openAiCompatibleProviderName("openai")).toBe("OpenAI");
		expect(openAiCompatibleProviderName("openrouter")).toBe("OpenRouter");
	});

	it("detects runner preflight and translator failures", () => {
		expect(
			isPreflightOrTranslatorFailure(
				"Preflight failed: openai auth but ANTHROPIC_MODEL is unset",
			),
		).toBe(true);
		expect(
			isPreflightOrTranslatorFailure(
				"translator is unreachable: ECONNREFUSED",
			),
		).toBe(true);
		expect(
			isPreflightOrTranslatorFailure("translator health check failed: 502"),
		).toBe(true);
		// Unrelated runtime errors are not misclassified as preflight/translator.
		expect(isPreflightOrTranslatorFailure("rate limit exceeded")).toBe(false);
		expect(
			isPreflightOrTranslatorFailure("the model returned an error"),
		).toBe(false);
	});
});

describe("unrunnable-task failure messaging — properties", () => {
	/** The two OpenAI-compatible provider types and their display names. */
	const OPENAI_COMPATIBLE = {
		openai: { name: "OpenAI", otherName: "OpenRouter" },
		openrouter: { name: "OpenRouter", otherName: "OpenAI" },
	} as const;

	const openAiCompatibleTypeArb = fc.constantFrom(
		"openai" as const,
		"openrouter" as const,
	);

	// Feature: multi-provider-model-switching, Property 17: Unrunnable
	// OpenAI-compatible task names the provider and persists nothing — for any
	// OpenAI-compatible provider type, when the runner cannot execute the task
	// the user-facing failure message names that configured provider type and
	// no partial task result is persisted. Persistence happens in taskRunner.ts
	// (settle writes status=failed only, no diff/PR), so the "persists nothing"
	// aspect is asserted here at the message/contract level: the message states
	// nothing was pushed and never implies a retry on another provider/model.
	// Validates: Requirements 7.3
	it("Property 17: clear-failure message names the configured provider and implies no partial result", () => {
		fc.assert(
			fc.property(openAiCompatibleTypeArb, (type) => {
				const { name, otherName } = OPENAI_COMPATIBLE[type];
				const msg = buildProviderUnavailableMessage(type);

				// Names the configured provider.
				expect(msg).toContain(name);
				// Never names the other OpenAI-compatible provider or Anthropic,
				// so it cannot imply a retry on a different provider.
				expect(msg).not.toContain(otherName);
				expect(msg).not.toContain("Anthropic");
				expect(msg).not.toContain("anthropic");

				// States the task could not run and that nothing was persisted
				// (no partial result / diff / PR pushed).
				const lower = msg.toLowerCase();
				expect(lower).toContain("couldn't run this task");
				expect(lower).toContain("nothing was pushed");

				// Mention-safe and within the Discord length budget.
				expect(hasActiveMention(msg)).toBe(false);
				expect(msg.length).toBeGreaterThan(0);
				expect(msg.length).toBeLessThanOrEqual(2000);

				// Display-name mapping is consistent with the message.
				expect(openAiCompatibleProviderName(type)).toBe(name);
			}),
			{ numRuns: 100 },
		);
	});

	// Feature: multi-provider-model-switching, Property 17 (gating): the
	// provider-named clear-failure copy is only emitted for runner failures that
	// mean the task could not execute on the configured provider — preflight or
	// translator failures. isPreflightOrTranslatorFailure must detect those and
	// reject unrelated runtime errors that should map to the generic taxonomy.
	// Validates: Requirements 7.3
	it("Property 17: preflight/translator failures gate the provider-named message", () => {
		// Strings that contain a preflight/translator marker are gated in.
		const preflightMarkerArb = fc
			.tuple(
				fc.string(),
				fc.constantFrom(
					"preflight failed",
					"Preflight Failed",
					"translator",
				),
				fc.string(),
			)
			.map(([a, marker, b]) => `${a}${marker}${b}`);

		fc.assert(
			fc.property(preflightMarkerArb, (message) => {
				expect(isPreflightOrTranslatorFailure(message)).toBe(true);
			}),
			{ numRuns: 100 },
		);

		// Strings with no preflight/translator marker are not misclassified.
		const noMarkerArb = fc
			.string()
			.filter((s) => !/preflight failed|translator/i.test(s));
		fc.assert(
			fc.property(noMarkerArb, (message) => {
				expect(isPreflightOrTranslatorFailure(message)).toBe(false);
			}),
			{ numRuns: 100 },
		);
	});
});
