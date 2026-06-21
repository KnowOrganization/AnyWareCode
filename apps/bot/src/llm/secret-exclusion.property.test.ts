/**
 * Feature: multi-provider-model-switching, Property 5: Secret-exclusion
 * invariant across all user-facing output (Req 3.6, 8.2, 9.5).
 *
 * Generates a token and drives every output-producing path that handles a
 * credential — credential validation, the chat-path and task-path failure
 * messages, the Model_Selector responses, and the provider clear-failure copy —
 * asserting that neither the raw token nor its `Bearer <token>` form appears in
 * any returned string. Network is injected (no real I/O).
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { LlmAuth, ProbeFetch } from "./credentials.js";
import { validateLlmAuth } from "./credentials.js";
import {
	buildChatFailureMessage,
	buildTaskFailureMessage,
	buildProviderUnavailableMessage,
} from "./messages.js";
import type { FailureMode } from "./failures.js";
import { applyModelChange, type ModelProbe } from "../discord/model.js";

const MODES: FailureMode[] = [
	"rate_limited",
	"auth_failed",
	"overloaded",
	"model_error",
	"network_error",
];

/** Token arbitrary: realistic key-ish strings that must never surface. */
const tokenArb = fc
	.string({ minLength: 8, maxLength: 60 })
	.filter((s) => s.trim().length >= 8);

function leaks(out: string, token: string): boolean {
	return out.includes(token) || out.includes(`Bearer ${token}`);
}

describe("secret-exclusion across all user-facing output (Property 5)", () => {
	it("credential validation reasons never echo the token", async () => {
		await fc.assert(
			fc.asyncProperty(
				tokenArb,
				fc.constantFrom(401, 403, 200, 400, 500, 0),
				async (token, status) => {
					const auth: LlmAuth = { type: "openai", token, model: "m" };
					// status 0 → simulate a transport/abort error (fetch throws).
					const fetchFn: ProbeFetch =
						status === 0
							? async () => {
									throw new Error(`boom with ${token} Bearer ${token}`);
								}
							: async () => ({ status, text: async () => `body ${token}` });
					const res = await validateLlmAuth(auth, { fetchFn });
					if (!res.ok) expect(leaks(res.reason, token)).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("Model_Selector responses never echo the token", async () => {
		await fc.assert(
			fc.asyncProperty(
				tokenArb,
				fc.constantFrom("ok", "unavailable", "unvalidated"),
				fc.oneof(
					fc.constant(""),
					fc.string({ minLength: 1, maxLength: 40 }),
					fc.string({ minLength: 257, maxLength: 300 }),
				),
				async (token, outcome, candidate) => {
					const auth: LlmAuth = { type: "openrouter", token, model: "m" };
					const probe: ModelProbe = async () =>
						outcome as "ok" | "unavailable" | "unvalidated";
					const store = { setModel: async (_m: string) => {} };
					const res = await applyModelChange(store, auth, candidate, { probe });
					const out = res.ok ? `set ${res.model}` : res.reason;
					expect(leaks(out, token)).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("chat/task failure messages and provider clear-failure copy never echo the token", () => {
		fc.assert(
			fc.property(
				tokenArb,
				fc.constantFrom(...MODES),
				fc.constantFrom(
					"anthropic_api_key",
					"claude_oauth",
					"custom",
					"openai",
					"openrouter",
				),
				(token, mode, providerType) => {
					// The token is not an input to these builders by design; assert the
					// produced copy nonetheless cannot contain it (and that a token
					// smuggled into a custom model name would be caught is covered by
					// sanitization elsewhere — here we confirm the standard paths).
					const ctx = {
						failure: { mode, rateLimitInfo: { resetTimeMs: null, retryAfterMs: null } },
						providerType: providerType as LlmAuth["type"],
						customModelName: null,
					};
					expect(leaks(buildChatFailureMessage(ctx), token)).toBe(false);
					expect(leaks(buildTaskFailureMessage(ctx), token)).toBe(false);
					if (providerType === "openai" || providerType === "openrouter") {
						expect(
							leaks(buildProviderUnavailableMessage(providerType), token),
						).toBe(false);
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});
