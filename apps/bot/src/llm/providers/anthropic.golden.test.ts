import { describe, expect, it } from "vitest";
import {
	buildClassifyRequest,
	REPLY_SYSTEM_PROMPT,
	renderContext,
	type ChatContext,
} from "../chat.js";
import { buildAnthropicHeaders, type LlmAuth } from "../credentials.js";
import { AnthropicAdapter } from "./anthropic.js";

/**
 * Golden backward-compatibility guard (multi-provider-model-switching, task 2.3).
 *
 * This is the release-blocking guard that guarantees the `AnthropicAdapter`
 * (task 2.2) produces **byte-for-byte identical** requests to the pre-refactor
 * Anthropic code for all three legacy auth types — `anthropic_api_key`,
 * `claude_oauth`, and `custom`. If any of these assertions fail, a legacy
 * provider has regressed and the change must not ship (Req 6.3, 7.5).
 *
 * Two sources of truth are used as the "golden" baseline:
 *
 *  1. `buildAnthropicHeaders` (credentials.ts) and `buildClassifyRequest`
 *     (chat.ts) are the *original, still-present* pre-refactor functions. The
 *     adapter must match their output exactly, so they are called directly and
 *     compared via `JSON.stringify` (byte-identity, key-order sensitive).
 *  2. The reply-request body (inline in `generateChatReply`) and the
 *     probe/validation body (inline in `validateLlmAuth`) were never extracted
 *     into standalone functions, so their pre-refactor literals are captured
 *     here as frozen snapshot fixtures and compared byte-for-byte.
 *
 * `JSON.stringify` is used for every comparison because it is sensitive to key
 * insertion order — the strictest practical notion of "byte-identical" request
 * bodies and header maps.
 */

// --- Auth fixtures: one per legacy provider type ---------------------------

const ANTHROPIC_API_KEY_AUTH: LlmAuth = {
	type: "anthropic_api_key",
	token: "sk-ant-api-fixture-token",
};

const CLAUDE_OAUTH_AUTH: LlmAuth = {
	type: "claude_oauth",
	token: "oauth-fixture-access-token",
};

const CUSTOM_AUTH: LlmAuth = {
	type: "custom",
	token: "custom-bearer-fixture-token",
	baseUrl: "https://anthropic-compatible.example.com/",
	model: "custom-pinned-model-v1",
};

const LEGACY_AUTHS: ReadonlyArray<{ label: string; auth: LlmAuth }> = [
	{ label: "anthropic_api_key", auth: ANTHROPIC_API_KEY_AUTH },
	{ label: "claude_oauth", auth: CLAUDE_OAUTH_AUTH },
	{ label: "custom", auth: CUSTOM_AUTH },
];

// --- Shared call inputs -----------------------------------------------------

/** Fallback chat model used by the classifier for non-custom providers. */
const CHAT_MODEL = "claude-sonnet-fixture-model";

/**
 * The fixed probe model the pre-refactor `validateLlmAuth` used for non-custom
 * providers. Captured verbatim from the original inline literal.
 */
const PROBE_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** A representative chat context exercising history, mention, repo, and a
 *  finished task so `renderContext` produces a non-trivial body. */
const CTX: ChatContext = {
	history: [
		{
			author: "alice",
			isBot: false,
			timestamp: "2024-01-01T00:00:00.000Z",
			text: "the login endpoint 500s on empty body",
		},
		{
			author: "AnyWareCode",
			isBot: true,
			timestamp: "2024-01-01T00:01:00.000Z",
			text: "looking into it",
		},
	],
	mention: { author: "bob", text: "@AnyWareCode can you fix this?" },
	channelName: "dev",
	repoFullName: "acme/widgets",
	finishedTask: {
		prompt: "add input validation to the login route",
		prNumber: 42,
		status: "completed",
	},
};

/**
 * The pre-refactor probe model selection: `validateLlmAuth` sent the pinned
 * `auth.model` for `custom`, and a fixed haiku model otherwise.
 */
function probeModelFor(auth: LlmAuth): string {
	return auth.type === "custom" ? auth.model : PROBE_DEFAULT_MODEL;
}

describe("AnthropicAdapter golden backward-compat (task 2.3)", () => {
	describe.each(LEGACY_AUTHS)(
		"$label produces byte-identical requests",
		({ auth }) => {
			it("endpoint URL + headers match buildAnthropicHeaders", () => {
				const golden = buildAnthropicHeaders(auth);
				const actual = AnthropicAdapter.endpoint(auth);
				expect(JSON.stringify(actual)).toBe(JSON.stringify(golden));
			});

			it("classify body matches buildClassifyRequest", () => {
				// Original selected the model as: custom -> auth.model, else chatModel.
				const golden = buildClassifyRequest(auth, CHAT_MODEL, CTX);
				const model = AnthropicAdapter.effectiveModel(auth, CHAT_MODEL);
				const actualBody = AnthropicAdapter.buildClassifyBody(model, CTX);
				expect(JSON.stringify(actualBody)).toBe(
					JSON.stringify(golden.body),
				);
			});

			it("reply body matches the pre-refactor generateChatReply literal", () => {
				// Snapshot fixture: the exact body generateChatReply serialized.
				const goldenReplyBody = {
					model: auth.type === "custom" ? auth.model : CHAT_MODEL,
					max_tokens: 4096,
					system: REPLY_SYSTEM_PROMPT,
					messages: [{ role: "user", content: renderContext(CTX) }],
				};
				const model = AnthropicAdapter.effectiveModel(auth, CHAT_MODEL);
				const actualBody = AnthropicAdapter.buildReplyBody(model, CTX);
				expect(JSON.stringify(actualBody)).toBe(
					JSON.stringify(goldenReplyBody),
				);
			});

			it("probe body matches the pre-refactor validateLlmAuth literal", () => {
				// Snapshot fixture: the exact body validateLlmAuth serialized.
				const goldenProbeBody = {
					model: probeModelFor(auth),
					max_tokens: 1,
					messages: [{ role: "user", content: "hi" }],
				};
				const actualBody = AnthropicAdapter.buildProbeBody(
					probeModelFor(auth),
				);
				expect(JSON.stringify(actualBody)).toBe(
					JSON.stringify(goldenProbeBody),
				);
			});
		},
	);

	it("covers all three legacy auth types", () => {
		expect(LEGACY_AUTHS.map((a) => a.auth.type)).toEqual([
			"anthropic_api_key",
			"claude_oauth",
			"custom",
		]);
	});
});
