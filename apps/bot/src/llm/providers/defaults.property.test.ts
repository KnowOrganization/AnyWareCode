import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config.js";
import {
	defaultModelFor,
	effectiveModel,
	type ProviderType,
} from "./defaults.js";

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

/** Every configurable provider type the effective-model rule must cover. */
const providerTypeArb: fc.Arbitrary<ProviderType> = fc.constantFrom(
	"anthropic_api_key",
	"claude_oauth",
	"custom",
	"openai",
	"openrouter",
);

/**
 * Stored models spanning the full input space the rule must handle:
 * null, undefined, whitespace-only, and non-empty values (some carrying
 * surrounding whitespace that must be trimmed).
 */
const storedModelArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
	fc.constant(null),
	fc.constant(undefined),
	// whitespace-only strings (spaces, tabs, newlines)
	fc
		.array(fc.constantFrom(" ", "\t", "\n", "\r"), {
			minLength: 0,
			maxLength: 8,
		})
		.map((parts) => parts.join("")),
	// non-empty model identifiers, optionally wrapped in surrounding whitespace
	fc
		.tuple(
			fc
				.array(fc.constantFrom(" ", "\t", "\n"), { maxLength: 4 })
				.map((p) => p.join("")),
			fc
				.string({ minLength: 1, maxLength: 64 })
				.filter((s) => s.trim().length > 0),
			fc
				.array(fc.constantFrom(" ", "\t", "\n"), { maxLength: 4 })
				.map((p) => p.join("")),
		)
		.map(([lead, core, trail]) => `${lead}${core}${trail}`),
);

describe("Property 7: Effective-model resolution", () => {
	// Feature: multi-provider-model-switching, Property 7: Effective-model resolution —
	// for any configured provider type and any nullable stored model, the effective
	// model equals the trimmed stored model when that trimmed value is non-empty, and
	// the provider type's Default_Model otherwise.
	// Validates: Requirements 5.4
	it("returns the trimmed stored model when non-empty, else the provider Default_Model", () => {
		const c = cfg();
		fc.assert(
			fc.property(providerTypeArb, storedModelArb, (type, storedModel) => {
				const trimmed = storedModel?.trim();
				const expected =
					trimmed && trimmed.length > 0
						? trimmed
						: defaultModelFor(type, c);
				expect(effectiveModel(type, storedModel, c)).toBe(expected);
			}),
			{ numRuns: 100 },
		);
	});
});
