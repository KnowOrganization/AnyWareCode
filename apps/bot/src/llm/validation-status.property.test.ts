import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	type LlmAuth,
	type ProbeFetch,
	validateLlmAuth,
} from "./credentials.js";

/**
 * Property 4: Validation status classification (auth-fail vs authenticated).
 *
 * For any validation response status, `validateLlmAuth` classifies the outcome
 * solely from the HTTP status returned by the probe:
 *   - `401` / `403` → rejection (`ok: false`), credential is NOT persisted, and
 *     the reason never contains the token or its `Bearer` form (Req 3.3, 3.6).
 *   - `200` / `400` (a parameter error that nonetheless authenticated) →
 *     acceptance (`ok: true`), so the credential is persisted (Req 3.4).
 *   - any other status → connection-level rejection (`ok: false`) (Req 3.5).
 *
 * Persistence is gated on `ok` at the call sites; this test asserts the `ok`
 * flag that drives that gate. Both adapter families are exercised — the
 * OpenAI-compatible providers (`openai`, `openrouter`) and an Anthropic auth
 * type — so the classification is verified across adapter dispatch.
 */

/**
 * Tokens shaped like real provider credentials: a fixed prefix plus a long
 * alphanumeric body. This keeps a generated token from coincidentally being a
 * substring of the fixed reason copy (which mentions e.g. "401/403"), so the
 * secret-exclusion assertion checks real exclusion rather than tripping on a
 * pathological one- or three-character token.
 */
const tokenArb: fc.Arbitrary<string> = fc
	.stringMatching(/^[A-Za-z0-9]{16,48}$/)
	.map((s) => `sk-${s}`);

const modelArb = fc.string({ minLength: 1, maxLength: 80 });

/** Arbitrary auth spanning OpenAI-compatible providers and an Anthropic type. */
const authArb: fc.Arbitrary<LlmAuth> = fc.oneof(
	fc
		.record({ token: tokenArb, model: modelArb })
		.map(({ token, model }): LlmAuth => ({ type: "openai", token, model })),
	fc
		.record({ token: tokenArb, model: modelArb })
		.map(
			({ token, model }): LlmAuth => ({ type: "openrouter", token, model }),
		),
	tokenArb.map((token): LlmAuth => ({ type: "anthropic_api_key", token })),
);

/**
 * Status arbitrary that reliably covers every classification bucket: the four
 * decisive statuses (200/400 → ok, 401/403 → auth-fail) plus a broad spread of
 * other HTTP statuses that must fall through to the connection-failed branch.
 */
const statusArb: fc.Arbitrary<number> = fc.oneof(
	fc.constantFrom(200, 400, 401, 403),
	fc.integer({ min: 100, max: 599 }),
);

/** A probe fetch that resolves immediately with the chosen status. */
function fetchReturningStatus(status: number): ProbeFetch {
	return () =>
		Promise.resolve({
			status,
			text: () => Promise.resolve(""),
		});
}

describe("Property 4: Validation status classification (auth-fail vs authenticated)", () => {
	// Feature: multi-provider-model-switching, Property 4: Validation status
	// classification (auth-fail vs authenticated) — for any validation response
	// status, a 401 or 403 yields rejection with no persistence, while a 200 or a
	// 400 (parameter error that nonetheless authenticated) yields acceptance and
	// persistence.
	// Validates: Requirements 3.3, 3.4

	it("classifies 401/403 as rejection and 200/400 as acceptance for every adapter", async () => {
		await fc.assert(
			fc.asyncProperty(authArb, statusArb, async (auth, status) => {
				const result = await validateLlmAuth(auth, {
					fetchFn: fetchReturningStatus(status),
					// Deterministic, timer-free: the fake fetch resolves before any
					// deadline could fire, so the timer seam is inert.
					setTimeoutFn: () => 0,
					clearTimeoutFn: () => {},
				});

				if (status === 401 || status === 403) {
					// Req 3.3 — auth failure → reject, gate persistence off.
					expect(result.ok).toBe(false);
					// Req 3.6 — the reason never leaks the token or its Bearer form.
					if (!result.ok) {
						expect(result.reason).not.toContain(auth.token);
						expect(result.reason).not.toContain(`Bearer ${auth.token}`);
					}
				} else if (status === 200 || status === 400) {
					// Req 3.4 — success / authenticated-param-error → accept, persist.
					expect(result.ok).toBe(true);
				} else {
					// Req 3.5 — any other status is a connection-level rejection.
					expect(result.ok).toBe(false);
					if (!result.ok) {
						expect(result.reason).not.toContain(auth.token);
					}
				}
			}),
			{ numRuns: 100 },
		);
	});
});
