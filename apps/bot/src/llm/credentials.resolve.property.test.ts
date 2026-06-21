import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Db } from "@anywarecode/db";
import { loadConfig } from "../config.js";
import { encryptCredential, resolveLlmAuth } from "./credentials.js";
import { effectiveModel } from "./providers/defaults.js";

/**
 * Minimal valid env for loadConfig. CREDENTIAL_SECRET must match the secret used
 * to encrypt the guild credential blob so resolveLlmAuth can decrypt it.
 */
const CREDENTIAL_SECRET = "x".repeat(32);

function cfg() {
	return loadConfig({
		DISCORD_TOKEN: "discord-token",
		DISCORD_CLIENT_ID: "client-id",
		GITHUB_APP_ID: "123456",
		GITHUB_APP_PRIVATE_KEY: "-----BEGIN KEY-----\\nabc\\n-----END KEY-----",
		CREDENTIAL_SECRET,
		DATABASE_URL: "postgres://user:pass@localhost:5432/db",
		PUBLIC_URL: "https://example.com",
		STATE_SECRET: "y".repeat(16),
	} as NodeJS.ProcessEnv);
}

/** A fake Db whose only behavior is returning a fixed guild row from the query seam. */
function fakeDb(guild: unknown): Db {
	return {
		query: {
			guilds: {
				findFirst: async () => guild,
			},
		},
	} as unknown as Db;
}

/** OpenAI-compatible provider types this property covers. */
const providerTypeArb = fc.constantFrom<"openai" | "openrouter">(
	"openai",
	"openrouter",
);

/** Non-empty credential tokens (the decrypted secret the auth must carry). */
const tokenArb = fc
	.string({ minLength: 1, maxLength: 256 })
	.filter((s) => s.length > 0);

/**
 * Stored Selected_Model spanning the input space: null (→ Default_Model),
 * whitespace-only (→ Default_Model), and non-empty values, some wrapped in
 * surrounding whitespace that the effective-model rule must trim.
 */
const storedModelArb: fc.Arbitrary<string | null> = fc.oneof(
	fc.constant(null),
	fc
		.array(fc.constantFrom(" ", "\t", "\n", "\r"), {
			minLength: 0,
			maxLength: 6,
		})
		.map((parts) => parts.join("")),
	fc
		.tuple(
			fc
				.array(fc.constantFrom(" ", "\t"), { maxLength: 3 })
				.map((p) => p.join("")),
			fc
				.string({ minLength: 1, maxLength: 64 })
				.filter((s) => s.trim().length > 0),
			fc
				.array(fc.constantFrom(" ", "\t"), { maxLength: 3 })
				.map((p) => p.join("")),
		)
		.map(([lead, core, trail]) => `${lead}${core}${trail}`),
);

/** Arbitrary, snowflake-ish guild ids (used as both lookup id and AAD). */
const guildIdArb = fc
	.string({ minLength: 1, maxLength: 32 })
	.filter((s) => s.length > 0);

describe("Property 16: Resolved task auth carries provider type, credential, and effective model", () => {
	// Feature: multi-provider-model-switching, Property 16: Resolved task auth carries
	// provider type, credential, and effective model — for any configured OpenAI-compatible
	// guild, the authentication resolved for the Task_Path carries the provider type, the
	// decrypted token, and the guild's effective model (Selected_Model when set, else the
	// provider type's Default_Model).
	// Validates: Requirements 7.1
	it("resolves { type, decrypted token, effectiveModel } for OpenAI-compatible guild rows", async () => {
		const config = cfg();
		await fc.assert(
			fc.asyncProperty(
				guildIdArb,
				providerTypeArb,
				tokenArb,
				storedModelArb,
				async (guildId, providerType, token, llmModel) => {
					const llmCredentialEnc = encryptCredential(
						CREDENTIAL_SECRET,
						guildId,
						token,
					);
					const db = fakeDb({
						id: guildId,
						llmProviderType: providerType,
						llmCredentialEnc,
						llmBaseUrl: null,
						llmModel,
					});

					const resolved = await resolveLlmAuth(db, config, guildId);

					expect(resolved.auth).not.toBeNull();
					if (resolved.auth === null) return;
					expect(resolved).toMatchObject({ source: "guild" });
					expect(resolved.auth.type).toBe(providerType);
					expect(resolved.auth.token).toBe(token);
					if (
						resolved.auth.type === "openai" ||
						resolved.auth.type === "openrouter"
					) {
						expect(resolved.auth.model).toBe(
							effectiveModel(providerType, llmModel, config),
						);
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});
