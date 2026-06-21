import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Db } from "@anywarecode/db";
import { loadConfig } from "../config.js";
import {
	decryptCredential,
	encryptCredential,
	resolveLlmAuth,
} from "./credentials.js";

/**
 * Secret the running config uses to decrypt guild credential blobs. Every blob
 * this property feeds in is constructed to NOT decrypt under this secret +
 * the lookup guildId (random junk, malformed v1 envelopes, or a valid envelope
 * sealed under a different secret/guild), so resolveLlmAuth must hit the
 * "credential unreadable" branch (Req 8.3).
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

/** All provider types a configured guild may carry, including OpenAI-compatible and Anthropic. */
const providerTypeArb = fc.constantFrom<
	"openai" | "openrouter" | "anthropic_api_key" | "claude_oauth" | "custom"
>("openai", "openrouter", "anthropic_api_key", "claude_oauth", "custom");

/** Arbitrary, snowflake-ish guild ids (used as both lookup id and AAD). */
const guildIdArb = fc
	.string({ minLength: 1, maxLength: 32 })
	.filter((s) => s.length > 0);

/**
 * Arbitrary credential blobs that must NOT decrypt under CREDENTIAL_SECRET +
 * the lookup guildId. Three families span the failure space:
 *  - random opaque strings (not a v1 envelope at all),
 *  - malformed `v1.x.y.z`-shaped strings (right prefix/arity, junk parts),
 *  - well-formed envelopes sealed under a DIFFERENT secret or guild (the
 *    AES-256-GCM auth tag / AAD check rejects them).
 */
function undecryptableBlobArb(lookupGuildId: string): fc.Arbitrary<string> {
	const randomJunk = fc.string({ minLength: 0, maxLength: 256 });

	const malformedV1 = fc
		.tuple(
			fc.string({ maxLength: 32 }),
			fc.string({ maxLength: 32 }),
			fc.string({ maxLength: 32 }),
		)
		.map(([a, b, c]) => `v1.${a}.${b}.${c}`);

	const sealedUnderWrongSecret = fc
		.tuple(
			fc.string({ minLength: 1, maxLength: 64 }).map((s) => `${s}-other`),
			fc.string({ minLength: 1, maxLength: 64 }),
		)
		.map(([wrongSecret, plaintext]) =>
			encryptCredential(wrongSecret, lookupGuildId, plaintext),
		);

	const sealedUnderWrongGuild = fc
		.tuple(
			fc
				.string({ minLength: 1, maxLength: 32 })
				.map((g) => `${g}-other-guild`),
			fc.string({ minLength: 1, maxLength: 64 }),
		)
		.map(([wrongGuild, plaintext]) =>
			encryptCredential(CREDENTIAL_SECRET, wrongGuild, plaintext),
		);

	return fc.oneof(
		randomJunk,
		malformedV1,
		sealedUnderWrongSecret,
		sealedUnderWrongGuild,
	);
}

describe("Property 19: Undecryptable credential is treated as unconfigured", () => {
	// Feature: multi-provider-model-switching, Property 19: Undecryptable credential is
	// treated as unconfigured — when a guild has a Provider_Type + stored credential blob
	// but the blob cannot be decrypted under the configured secret, resolveLlmAuth aborts
	// the dependent operation, treats the guild as unconfigured, and returns
	// { auth: null, reason } whose reason instructs the Admin to reconnect via `/connect llm`,
	// never a partial or fallback credential.
	// Validates: Requirements 8.3
	it("returns { auth: null, reason: /connect llm } for any undecryptable blob, never a partial credential", async () => {
		const config = cfg();
		// Correlate the blob with the guildId so the "sealed under wrong guild"
		// family is genuinely sealed against THIS lookup id.
		const caseArb = guildIdArb.chain((guildId) =>
			fc.record({
				guildId: fc.constant(guildId),
				providerType: providerTypeArb,
				llmBaseUrl: fc.option(fc.string({ minLength: 1, maxLength: 64 }), {
					nil: null,
				}),
				llmModel: fc.option(fc.string({ minLength: 1, maxLength: 64 }), {
					nil: null,
				}),
				llmCredentialEnc: undecryptableBlobArb(guildId),
			}),
		);

		await fc.assert(
			fc.asyncProperty(
				caseArb,
				async ({
					guildId,
					providerType,
					llmBaseUrl,
					llmModel,
					llmCredentialEnc,
				}) => {
					// Precondition: the blob really is undecryptable under the configured
					// secret + lookup guild. (Random strings could in principle collide;
					// this keeps the property meaningful.)
					fc.pre(
						decryptCredential(
							CREDENTIAL_SECRET,
							guildId,
							llmCredentialEnc,
						) === null,
					);

					const db = fakeDb({
						id: guildId,
						llmProviderType: providerType,
						llmCredentialEnc,
						llmBaseUrl,
						llmModel,
					});

					const resolved = await resolveLlmAuth(db, config, guildId);

					// Treated as unconfigured: no auth, no partial credential.
					expect(resolved.auth).toBeNull();
					// No leaked credential fields on the failure result.
					expect(resolved).not.toHaveProperty("source");
					expect(resolved).not.toHaveProperty("token");

					// Reason instructs the admin to reconnect via `/connect llm`.
					expect("reason" in resolved).toBe(true);
					if ("reason" in resolved) {
						expect(typeof resolved.reason).toBe("string");
						expect(resolved.reason.length).toBeGreaterThan(0);
						expect(resolved.reason).toContain("/connect llm");
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});
