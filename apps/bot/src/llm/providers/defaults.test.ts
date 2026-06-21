import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config.js";
import { defaultModelFor, effectiveModel } from "./defaults.js";

function cfg() {
	return loadConfig({
		DISCORD_TOKEN: "discord-token",
		DISCORD_CLIENT_ID: "client-id",
		GITHUB_APP_ID: "123456",
		GITHUB_APP_PRIVATE_KEY: "-----BEGIN KEY-----\\nabc\\n-----END KEY-----",
		CREDENTIAL_SECRET: "x".repeat(32),
		DATABASE_URL: "postgres://user:pass@localhost:5432/db",
		PUBLIC_URL: "https://example.com",
		STATE_SECRET: "y".repeat(16),
	} as NodeJS.ProcessEnv);
}

describe("defaultModelFor", () => {
	it("maps openai to OPENAI_DEFAULT_MODEL", () => {
		const c = cfg();
		expect(defaultModelFor("openai", c)).toBe(c.OPENAI_DEFAULT_MODEL);
	});

	it("maps openrouter to OPENROUTER_DEFAULT_MODEL", () => {
		const c = cfg();
		expect(defaultModelFor("openrouter", c)).toBe(c.OPENROUTER_DEFAULT_MODEL);
	});

	it("maps anthropic provider types to DEFAULT_MODEL", () => {
		const c = cfg();
		expect(defaultModelFor("anthropic_api_key", c)).toBe(c.DEFAULT_MODEL);
		expect(defaultModelFor("claude_oauth", c)).toBe(c.DEFAULT_MODEL);
	});

	it("falls back to DEFAULT_MODEL for custom when no row model is supplied", () => {
		const c = cfg();
		expect(defaultModelFor("custom", c)).toBe(c.DEFAULT_MODEL);
	});
});

describe("effectiveModel", () => {
	it("returns the trimmed stored model when non-empty", () => {
		const c = cfg();
		expect(effectiveModel("openai", "  gpt-4o  ", c)).toBe("gpt-4o");
	});

	it("falls back to the provider Default_Model when stored model is null", () => {
		const c = cfg();
		expect(effectiveModel("openai", null, c)).toBe(c.OPENAI_DEFAULT_MODEL);
	});

	it("falls back to the provider Default_Model when stored model is whitespace-only", () => {
		const c = cfg();
		expect(effectiveModel("openrouter", "   ", c)).toBe(
			c.OPENROUTER_DEFAULT_MODEL,
		);
	});

	it("falls back to the provider Default_Model when stored model is undefined", () => {
		const c = cfg();
		expect(effectiveModel("anthropic_api_key", undefined, c)).toBe(
			c.DEFAULT_MODEL,
		);
	});
});
