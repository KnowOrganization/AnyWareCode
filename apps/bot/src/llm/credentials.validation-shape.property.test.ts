import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	type LlmAuth,
	type ProbeFetch,
	validateLlmAuth,
} from "./credentials.js";

/**
 * Property 3: Credential validation uses the minimal Chat Completions shape and
 * gates persistence.
 *
 * For any OpenAI-compatible credential, the validator issues exactly one request
 * whose body is the OpenAI Chat Completions minimal payload (a single user
 * message with a minimal token cap) to the provider's `/v1/chat/completions`
 * endpoint, and the credential is persisted only when validation returns
 * success.
 *
 * `validateLlmAuth` itself only opens or closes the persistence gate by
 * returning `{ ok: true }` / `{ ok: false }`; the caller persists exactly when
 * the gate is open. We therefore assert the request shape directly and assert
 * the gate decision across the response-status ladder.
 */

/** Endpoints we expect the two OpenAI-compatible providers to probe. */
const EXPECTED_URL: Record<"openai" | "openrouter", string> = {
	openai: "https://api.openai.com/v1/chat/completions",
	openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

/** Arbitrary non-empty token (no leading/trailing whitespace). */
const tokenArb = fc
	.string({ minLength: 1, maxLength: 120 })
	.map((s) => s.trim())
	.filter((s) => s.length > 0);

/** Arbitrary non-empty model identifier (no leading/trailing whitespace). */
const modelArb = fc
	.string({ minLength: 1, maxLength: 80 })
	.map((s) => s.trim())
	.filter((s) => s.length > 0);

/** Arbitrary OpenAI-compatible credential carrying { type, token, model }. */
const openAiCompatibleAuthArb: fc.Arbitrary<
	Extract<LlmAuth, { type: "openai" | "openrouter" }>
> = fc.record({
	type: fc.constantFrom("openai" as const, "openrouter" as const),
	token: tokenArb,
	model: modelArb,
});

/** Deterministic, network-free deps: no-op timers, capturing fetch. */
function depsWithFetch(fetchFn: ProbeFetch) {
	return {
		fetchFn,
		// No-op timers so the 10s deadline never fires and no real timer is set.
		setTimeoutFn: () => 0,
		clearTimeoutFn: () => {},
	};
}

describe("Property 3: Credential validation uses the minimal Chat Completions shape and gates persistence", () => {
	// Feature: multi-provider-model-switching, Property 3: Credential validation
	// uses the minimal Chat Completions shape and gates persistence — the validator
	// issues exactly one minimal `/v1/chat/completions` request carrying the
	// effective model, and the credential is persisted only when validation
	// returns success.
	// Validates: Requirements 3.1

	it("issues exactly one minimal /v1/chat/completions request carrying the effective model", async () => {
		await fc.assert(
			fc.asyncProperty(openAiCompatibleAuthArb, async (auth) => {
				const calls: Array<{ url: string; body: string }> = [];
				const fetchFn: ProbeFetch = async (url, init) => {
					calls.push({ url, body: init.body });
					return { status: 200, text: async () => "" };
				};

				const result = await validateLlmAuth(auth, depsWithFetch(fetchFn));

				// Exactly one live request is issued (Req 3.1).
				expect(calls).toHaveLength(1);

				const call = calls[0]!;
				// Targets the provider's Chat Completions endpoint (Req 3.1).
				expect(call.url).toBe(EXPECTED_URL[auth.type]);
				expect(call.url.endsWith("/v1/chat/completions")).toBe(true);

				// Body is the minimal Chat Completions payload (Req 3.1): a single
				// user message and a one-token cap, carrying the effective model.
				const body = JSON.parse(call.body) as {
					model: string;
					messages: Array<{ role: string; content: unknown }>;
					max_tokens: number;
				};
				expect(body.model).toBe(auth.model);
				expect(body.max_tokens).toBe(1);
				expect(body.messages).toHaveLength(1);
				expect(body.messages[0]?.role).toBe("user");
				expect(body.messages[0]?.content).toBe("hi");

				// A 200 opens the persistence gate.
				expect(result.ok).toBe(true);
			}),
			{ numRuns: 100 },
		);
	});

	it("opens the persistence gate only on an authenticated status (200/400) and closes it on auth failure (401/403)", async () => {
		await fc.assert(
			fc.asyncProperty(
				openAiCompatibleAuthArb,
				fc.constantFrom(200, 400, 401, 403),
				async (auth, status) => {
					const fetchFn: ProbeFetch = async () => ({
						status,
						text: async () => "",
					});

					const result = await validateLlmAuth(
						auth,
						depsWithFetch(fetchFn),
					);

					// 200/400 authenticate → gate open → caller persists (Req 3.4).
					// 401/403 → gate closed → caller persists nothing (Req 3.3).
					const expectedOk = status === 200 || status === 400;
					expect(result.ok).toBe(expectedOk);
				},
			),
			{ numRuns: 100 },
		);
	});
});
