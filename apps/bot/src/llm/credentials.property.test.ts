import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./credentials.js";

/**
 * Non-empty token strings: any provider credential material we might store.
 */
const tokenArb: fc.Arbitrary<string> = fc
	.string({ minLength: 1, maxLength: 256 })
	.filter((s) => s.length > 0);

/** Guild ids: non-empty identifier strings (Discord snowflakes are strings). */
const guildIdArb: fc.Arbitrary<string> = fc
	.string({ minLength: 1, maxLength: 32 })
	.filter((s) => s.length > 0);

/**
 * CREDENTIAL_SECRET: HKDF input keying material, required to be >= 32 chars
 * (mirrors config validation).
 */
const secretArb: fc.Arbitrary<string> = fc
	.string({ minLength: 32, maxLength: 96 })
	.filter((s) => s.length >= 32);

describe("Property 18: Credential encryption round-trip is guild-bound", () => {
	// Feature: multi-provider-model-switching, Property 18: Credential encryption
	// round-trip is guild-bound — for any token and guild id, decrypting the
	// per-guild AES-256-GCM ciphertext produced for that token and guild returns
	// the original token, and decrypting under a different guild id returns null.
	// Validates: Requirements 8.1
	it("decrypts under the same guild and fails (null) under a different guild", () => {
		fc.assert(
			fc.property(
				secretArb,
				tokenArb,
				guildIdArb,
				guildIdArb,
				(secret, token, guildId, otherCandidate) => {
					const blob = encryptCredential(secret, guildId, token);

					// Same guild → original token recovered.
					expect(decryptCredential(secret, guildId, blob)).toBe(token);

					// Different guild (AAD mismatch) → null, never a usable credential.
					const otherGuildId =
						otherCandidate === guildId
							? `${otherCandidate}-x`
							: otherCandidate;
					expect(decryptCredential(secret, otherGuildId, blob)).toBeNull();
				},
			),
			{ numRuns: 100 },
		);
	});
});
