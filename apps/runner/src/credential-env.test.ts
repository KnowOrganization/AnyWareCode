import { describe, expect, it } from "vitest";
import { credentialEnv } from "./credential-env.js";

/**
 * Golden test for Requirement 7.5: the credential-env wiring for the three
 * legacy auth types (`anthropic_api_key`, `claude_oauth`, `custom`) must be a
 * byte-for-byte match to today's behavior — no drift as new providers are added.
 *
 * The expected maps below are pinned literals of the historical inline switch
 * arms from index.ts. If a change to the wiring is intended, these literals must
 * be updated deliberately; an accidental change fails the test.
 */
describe("credentialEnv (legacy auth wiring — golden)", () => {
	it("anthropic_api_key sets only ANTHROPIC_API_KEY = token", () => {
		expect(
			credentialEnv({ type: "anthropic_api_key", token: "sk-ant-123" }),
		).toEqual({ ANTHROPIC_API_KEY: "sk-ant-123" });
	});

	it("claude_oauth sets only CLAUDE_CODE_OAUTH_TOKEN = token", () => {
		expect(
			credentialEnv({ type: "claude_oauth", token: "oauth-abc" }),
		).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-abc" });
	});

	it("custom sets ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN and ANTHROPIC_MODEL", () => {
		expect(
			credentialEnv({
				type: "custom",
				token: "tok-xyz",
				baseUrl: "https://llm.example.dev",
				model: "deepseek-coder",
			}),
		).toEqual({
			ANTHROPIC_BASE_URL: "https://llm.example.dev",
			ANTHROPIC_AUTH_TOKEN: "tok-xyz",
			ANTHROPIC_MODEL: "deepseek-coder",
		});
	});

	it("never sets a foreign credential key for any legacy arm", () => {
		// Each legacy arm sets only its own keys: cross-credential leakage would
		// make the SDK reject the request, so assert the exact key sets.
		expect(
			Object.keys(
				credentialEnv({ type: "anthropic_api_key", token: "k" }),
			).sort(),
		).toEqual(["ANTHROPIC_API_KEY"]);
		expect(
			Object.keys(
				credentialEnv({ type: "claude_oauth", token: "k" }),
			).sort(),
		).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
		expect(
			Object.keys(
				credentialEnv({
					type: "custom",
					token: "k",
					baseUrl: "https://x.dev",
					model: "m",
				}),
			).sort(),
		).toEqual([
			"ANTHROPIC_AUTH_TOKEN",
			"ANTHROPIC_BASE_URL",
			"ANTHROPIC_MODEL",
		]);
	});

	it("does not wire env for translator-backed providers (openai/openrouter)", () => {
		// openai/openrouter env wiring is async (starts the translation sidecar)
		// and lives inline in index.ts, so the pure mapping returns nothing.
		expect(
			credentialEnv({ type: "openai", token: "sk-openai", model: "gpt-4o" }),
		).toEqual({});
		expect(
			credentialEnv({
				type: "openrouter",
				token: "sk-or",
				model: "openrouter/auto",
			}),
		).toEqual({});
	});
});
