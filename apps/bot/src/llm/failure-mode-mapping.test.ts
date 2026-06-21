import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OpenAiCompatibleAdapter } from "./providers/openai-compatible.js";
import {
	classifyResponse,
	type FailureMode,
	type HeaderGet,
} from "./failures.js";
import {
	buildChatFailureMessage,
	buildTaskFailureMessage,
	type MessageContext,
} from "./messages.js";

/**
 * Property-based test for failure-mode mapping (Req 6.6).
 *
 * Requirement 6.6: when an OpenAI-compatible provider returns a non-success
 * response, the Bot maps the failure to one of the five existing FailureMode
 * categories and responds using that category's existing failure-mode message
 * rather than a generic failure string.
 *
 * `classifyResponse` is the single status→FailureMode ladder for both wire
 * shapes; the OpenAI-compatible adapter's `isProviderErrorBody` (which always
 * returns `false`, letting the status ladder govern) is fed in to mirror the
 * production classify path for those providers.
 */

/** The five mutually-exclusive, exhaustive failure categories (Req 1.10). */
const ALL_MODES: readonly FailureMode[] = [
	"rate_limited",
	"auth_failed",
	"overloaded",
	"model_error",
	"network_error",
];

const PROVIDER_TYPES: MessageContext["providerType"][] = [
	"anthropic_api_key",
	"claude_oauth",
	"custom",
	"openai",
	"openrouter",
	"unknown",
];

/** Empty header view — non-success classification never needs header data here. */
const noHeaders: HeaderGet = () => null;

/** OpenAI-compatible soft-error detector: status ladder governs entirely. */
const isProviderError = (body: unknown): boolean =>
	new OpenAiCompatibleAdapter("https://api.openai.com").isProviderErrorBody(
		body,
	);

/**
 * Arbitrary non-success HTTP status: a mix of the documented status codes plus
 * a broad integer spread, with 200 (the only success status) excluded.
 */
const nonSuccessStatusArb: fc.Arbitrary<number> = fc
	.oneof(
		fc.constantFrom(401, 403, 429, 500, 502, 503, 400, 404, 529, 418, 408),
		fc.integer({ min: 100, max: 599 }),
		fc.integer({ min: 0, max: 1000 }),
	)
	.filter((status) => status !== 200);

const providerTypeArb: fc.Arbitrary<MessageContext["providerType"]> =
	fc.constantFrom(...PROVIDER_TYPES);

describe("failure-mode mapping — properties", () => {
	// Feature: multi-provider-model-switching, Property 15: Non-success responses
	// map to an existing failure-mode message — for any non-success status,
	// classifyResponse yields exactly one of the five FailureMode categories and
	// both message builders return that category's non-empty existing copy
	// rather than a generic fallback.
	// Validates: Requirements 6.6
	it("Property 15: non-success responses map to a single existing failure-mode message", () => {
		fc.assert(
			fc.property(
				nonSuccessStatusArb,
				providerTypeArb,
				(status, providerType) => {
					const result = classifyResponse({
						status,
						headers: noHeaders,
						body: null,
						receivedAtMs: 0,
						isProviderError,
					});

					// A non-success status is never a success outcome.
					expect(result.ok).toBe(false);
					if (result.ok) {
						return;
					}

					const { failure } = result;

					// Exactly one of the five categories.
					expect(ALL_MODES).toContain(failure.mode);

					const ctx: MessageContext = {
						failure,
						providerType,
						customModelName: null,
					};
					const chat = buildChatFailureMessage(ctx);
					const task = buildTaskFailureMessage(ctx);

					// The builders return that category's existing, non-empty copy.
					expect(typeof chat).toBe("string");
					expect(typeof task).toBe("string");
					expect(chat.length).toBeGreaterThan(0);
					expect(task.length).toBeGreaterThan(0);

					// Each message is the per-category copy, not a generic fallback:
					// the content marker is specific to the classified mode.
					const expectedMarker: Record<FailureMode, RegExp> = {
						rate_limited: /usage or rate limit/,
						auth_failed: /\/connect llm/,
						overloaded: /overloaded/,
						model_error: /unlikely to succeed/,
						network_error: /(could not be reached|network error)/,
					};
					expect(chat).toMatch(expectedMarker[failure.mode]);
					expect(task).toMatch(expectedMarker[failure.mode]);
				},
			),
			{ numRuns: 100 },
		);
	});
});
