import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

/**
 * A minimal env covering only the REQUIRED fields (those without a default),
 * so parsing succeeds and we can assert that the rate-limit-resilience fields
 * fall back to their declared defaults when unset.
 */
function minimalEnv(): NodeJS.ProcessEnv {
	return {
		DISCORD_TOKEN: "discord-token",
		DISCORD_CLIENT_ID: "client-id",
		GITHUB_APP_ID: "123456",
		GITHUB_APP_PRIVATE_KEY: "-----BEGIN KEY-----\\nabc\\n-----END KEY-----",
		CREDENTIAL_SECRET: "x".repeat(32),
		DATABASE_URL: "postgres://user:pass@localhost:5432/db",
		PUBLIC_URL: "https://example.com",
		STATE_SECRET: "y".repeat(16),
	} as NodeJS.ProcessEnv;
}

describe("loadConfig rate-limit-resilience defaults", () => {
	it("defaults CHAT_FALLBACK_ENABLED to false", () => {
		const cfg = loadConfig(minimalEnv());
		expect(cfg.CHAT_FALLBACK_ENABLED).toBe(false);
	});

	it("provides a CHAT_FALLBACK_MODEL default", () => {
		const cfg = loadConfig(minimalEnv());
		expect(typeof cfg.CHAT_FALLBACK_MODEL).toBe("string");
		expect(cfg.CHAT_FALLBACK_MODEL.length).toBeGreaterThan(0);
	});

	it("defaults RETRY_MAX_DELAY_SECONDS to 5 within [0,30]", () => {
		const cfg = loadConfig(minimalEnv());
		expect(cfg.RETRY_MAX_DELAY_SECONDS).toBe(5);
		expect(cfg.RETRY_MAX_DELAY_SECONDS).toBeGreaterThanOrEqual(0);
		expect(cfg.RETRY_MAX_DELAY_SECONDS).toBeLessThanOrEqual(30);
	});

	it("defaults CLASSIFIER_TIMEOUT_SECONDS to 60", () => {
		const cfg = loadConfig(minimalEnv());
		expect(cfg.CLASSIFIER_TIMEOUT_SECONDS).toBe(60);
	});
});
