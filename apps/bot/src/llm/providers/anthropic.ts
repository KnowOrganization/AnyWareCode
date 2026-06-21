/**
 * AnthropicAdapter (multi-provider-model-switching, task 2.2).
 *
 * A verbatim lift of today's Anthropic Messages-API code into the
 * `ProviderAdapter` seam. It covers the three legacy auth types
 * (`anthropic_api_key`, `claude_oauth`, `custom`) and is intentionally a
 * byte-for-byte reproduction of the existing behavior in `credentials.ts`,
 * `chat.ts`, and `failures.ts`:
 *
 *  - `endpoint`            ← `buildAnthropicHeaders` (credentials.ts)
 *  - `buildClassifyBody`   ← `buildClassifyRequest` body (chat.ts)
 *  - `buildReplyBody`      ← `generateChatReply` request body (chat.ts)
 *  - `buildProbeBody`      ← `validateLlmAuth` probe body (credentials.ts)
 *  - `extractDecision`     ← `findDecideBlock` + `intentDecisionSchema` (chat.ts)
 *  - `extractReplyText`    ← `extractReplyText` (chat.ts)
 *  - `isProviderErrorBody` ← `{type:"error"}` soft-error check (failures.ts)
 *  - `parseRateLimitInfo`  ← shared `parseRateLimitInfo` header names (failures.ts)
 *
 * No behavior change: the original functions remain in place so existing
 * callers keep working and the golden backward-compat test (task 2.3) can
 * compare this adapter's output against them. Shared prompt/tool constants and
 * `renderContext` are imported from `chat.ts` (single source of truth) rather
 * than duplicated, guaranteeing the request bodies stay byte-identical.
 */

import {
	DECIDE_TOOL,
	intentDecisionSchema,
	REPLY_SYSTEM_PROMPT,
	renderContext,
	SYSTEM_PROMPT,
	type ChatContext,
	type IntentDecision,
} from "../chat.js";
import type { LlmAuth } from "../credentials.js";
import {
	parseRateLimitInfo as parseAnthropicRateLimitInfo,
	type HeaderGet,
	type RateLimitInfo,
} from "../failures.js";
import type { ProviderAdapter } from "./types.js";

/**
 * Locate the `decide` tool_use block in a Messages-API response body.
 *
 * Verbatim lift of the private `findDecideBlock` helper in `chat.ts`.
 */
function findDecideBlock(body: unknown): { input?: unknown } | undefined {
	const content = (
		body as {
			content?: Array<{ type?: string; name?: string; input?: unknown }>;
		} | null
	)?.content;
	if (!Array.isArray(content)) return undefined;
	return content.find((b) => b?.type === "tool_use" && b?.name === "decide");
}

/**
 * Extract the joined, trimmed text from all `text` blocks in a response body.
 *
 * Verbatim lift of the private `extractReplyText` helper in `chat.ts`.
 */
function extractReplyTextFromBody(body: unknown): string {
	const content = (
		body as { content?: Array<{ type?: string; text?: string }> } | null
	)?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b) => b?.type === "text")
		.map((b) => b?.text ?? "")
		.join("")
		.trim();
}

/**
 * Detect a provider error indicator in a 200-status body. Anthropic returns
 * `{ "type": "error", ... }` for some soft errors even on HTTP 200.
 *
 * Verbatim lift of the private `isProviderErrorBody` helper in `failures.ts`.
 */
function isAnthropicProviderErrorBody(body: unknown): boolean {
	return (
		typeof body === "object" &&
		body !== null &&
		(body as { type?: unknown }).type === "error"
	);
}

/** Pull the human-readable error message + error type out of an Anthropic
 *  error body, tolerating partial/odd shapes. Used only by `isModelUnavailable`. */
function readAnthropicError(body: unknown): { message: string; type: string } {
	const err = (
		body as { error?: { message?: unknown; type?: unknown } } | null
	)?.error;
	const message = typeof err?.message === "string" ? err.message : "";
	const type = typeof err?.type === "string" ? err.type : "";
	return { message, type };
}

/** Matches an unknown/unavailable-model signal in an Anthropic 400/404 error. */
const MODEL_UNAVAILABLE_RE =
	/(not[_ ]?found|does not exist|unknown|invalid|unavailable|no such|not[_ ]?supported)/i;

export const AnthropicAdapter: ProviderAdapter = {
	/**
	 * Messages-API endpoint + auth headers for each provider type. Single source
	 * for the three auth shapes; used by credential probes and the chat
	 * classifier. Verbatim lift of `buildAnthropicHeaders` (credentials.ts).
	 */
	endpoint(auth: LlmAuth): { url: string; headers: Record<string, string> } {
		switch (auth.type) {
			case "anthropic_api_key":
				return {
					url: "https://api.anthropic.com/v1/messages",
					headers: {
						"x-api-key": auth.token,
						"anthropic-version": "2023-06-01",
					},
				};
			case "claude_oauth":
				return {
					url: "https://api.anthropic.com/v1/messages",
					headers: {
						authorization: `Bearer ${auth.token}`,
						"anthropic-version": "2023-06-01",
						"anthropic-beta": "oauth-2025-04-20",
					},
				};
			case "custom":
				return {
					url: `${auth.baseUrl.replace(/\/$/, "")}/v1/messages`,
					headers: {
						authorization: `Bearer ${auth.token}`,
						"anthropic-version": "2023-06-01",
					},
				};
			default: {
				// AnthropicAdapter only handles the three legacy auth types; any
				// other variant is dispatched to a different adapter upstream.
				throw new Error(
					`AnthropicAdapter cannot build an endpoint for auth type "${(auth as LlmAuth).type}"`,
				);
			}
		}
	},

	/**
	 * Effective model for the call: the row's pinned model for `custom`, else the
	 * passed fallback. Mirrors today's `auth.type === "custom" ? auth.model : <fallback>`.
	 */
	effectiveModel(auth: LlmAuth, fallbackModel: string): string {
		return auth.type === "custom" ? auth.model : fallbackModel;
	},

	/**
	 * Build the structured-classification request body. Verbatim lift of the
	 * body produced by `buildClassifyRequest` (chat.ts). Key order is preserved
	 * so JSON serialization is byte-identical.
	 */
	buildClassifyBody(model: string, ctx: ChatContext): unknown {
		return {
			model,
			max_tokens: 1024,
			system: SYSTEM_PROMPT,
			tools: [DECIDE_TOOL],
			tool_choice: { type: "tool", name: "decide" },
			messages: [{ role: "user", content: renderContext(ctx) }],
		};
	},

	/**
	 * Build the free-form reply request body. Verbatim lift of the body sent by
	 * `generateChatReply` (chat.ts). Key order preserved for byte-identity.
	 */
	buildReplyBody(model: string, ctx: ChatContext): unknown {
		return {
			model,
			max_tokens: 4096,
			system: REPLY_SYSTEM_PROMPT,
			messages: [{ role: "user", content: renderContext(ctx) }],
		};
	},

	/**
	 * Build the smallest valid credential/model probe body (Req 3.1). Verbatim
	 * lift of the probe body in `validateLlmAuth` (credentials.ts): a single
	 * trivial user message with `max_tokens: 1`. Key order preserved.
	 */
	buildProbeBody(model: string): unknown {
		return {
			model,
			max_tokens: 1,
			messages: [{ role: "user", content: "hi" }],
		};
	},

	/**
	 * Extract a structured intent decision, or null when none is present. Lifts
	 * `findDecideBlock` + `intentDecisionSchema` parsing from `classifyIntent`
	 * (chat.ts): a `decide` tool_use block whose input satisfies the schema.
	 */
	extractDecision(body: unknown): IntentDecision | null {
		const block = findDecideBlock(body);
		const parsed = intentDecisionSchema.safeParse(block?.input);
		return parsed.success ? parsed.data : null;
	},

	/** Extract the joined assistant reply text (Req 6.2). */
	extractReplyText(body: unknown): string {
		return extractReplyTextFromBody(body);
	},

	/** True when a 200 body actually encodes an Anthropic soft error. */
	isProviderErrorBody(body: unknown): boolean {
		return isAnthropicProviderErrorBody(body);
	},

	/**
	 * Parse Anthropic rate-limit headers into the shared `RateLimitInfo`.
	 * Delegates to the existing `parseRateLimitInfo` (failures.ts) so the
	 * Anthropic header names (`anthropic-ratelimit-unified-*`, `retry-after`)
	 * are preserved exactly.
	 */
	parseRateLimitInfo(args: {
		headers: HeaderGet;
		receivedAtMs: number;
	}): RateLimitInfo {
		return parseAnthropicRateLimitInfo(args);
	},

	/**
	 * Classify a probe/validation outcome as a model-unavailable signal: a
	 * `400`/`404` whose Anthropic error body indicates an unknown/unavailable
	 * model maps to `true` (Req 10.2). Auth/timeout/network and any other status
	 * map to `false` (Req 10.3).
	 */
	isModelUnavailable(status: number, body: unknown): boolean {
		if (status !== 400 && status !== 404) return false;
		const { message, type } = readAnthropicError(body);
		const haystack = `${type} ${message}`;
		return /model/i.test(haystack) && MODEL_UNAVAILABLE_RE.test(haystack);
	},
};
