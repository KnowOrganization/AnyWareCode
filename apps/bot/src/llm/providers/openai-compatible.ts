/**
 * OpenAI-compatible provider adapter (multi-provider-model-switching, Task 3.1).
 *
 * Covers the two providers that speak the **OpenAI Chat Completions**
 * request/response shape — `openai` (OpenAI + Codex models) and `openrouter`.
 * They differ only by base URL (`api.openai.com` vs `openrouter.ai/api`) and
 * therefore share a single implementation parameterized by that base URL.
 *
 * Everything content-level — the system prompt, the rendered conversation
 * context, the `decide` parameter schema, and the `intentDecisionSchema`
 * validator — is reused verbatim from `chat.ts`; only the wire envelope differs
 * from the Anthropic Messages shape:
 *
 *  - auth header is `authorization: Bearer <token>` (no `anthropic-version`),
 *  - the system prompt is the first `messages[]` item (`role:"system"`) rather
 *    than a top-level `system` field,
 *  - the structured decision is a forced `decide` *function* tool surfaced at
 *    `choices[0].message.tool_calls[0].function.arguments` (a JSON string),
 *  - the plain reply is `choices[0].message.content`,
 *  - there is no 200-status soft-error body — HTTP status governs entirely.
 *
 * This module performs no I/O; it only builds request bodies and parses
 * response bodies. The shared status→`FailureMode` classifier, retry, and
 * message-builder layers stay common across providers.
 */

import {
	DECIDE_PARAMETERS,
	intentDecisionSchema,
	REPLY_SYSTEM_PROMPT,
	renderContext,
	SYSTEM_PROMPT,
	type ChatContext,
	type IntentDecision,
} from "../chat.js";
import type { LlmAuth } from "../credentials.js";
import type { HeaderGet, RateLimitInfo } from "../failures.js";
import type { ProviderAdapter } from "./types.js";

/** Production base URL for the OpenAI provider (no trailing slash). */
export const OPENAI_BASE_URL = "https://api.openai.com";
/** Production base URL for the OpenRouter provider (no trailing slash). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

/** Upper bound (seconds) applied to a `retry-after` value before use. */
const RETRY_AFTER_MAX_SECONDS = 86400;
/** Maximum length kept for the rate-limit status string. */
const STATUS_MAX_CHARS = 256;

/**
 * Strictly parse a header value as a non-negative integer, mirroring the
 * Anthropic parser in `failures.ts`: accepted only when, after trimming, it is
 * a non-empty run of decimal digits. Anything else yields `null` (treat as
 * absent).
 */
function parseNonNegativeInt(raw: string | null): number | null {
	if (raw === null) {
		return null;
	}
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/** Lower-cased string field accessor that tolerates non-string/absent values. */
function lowerStr(value: unknown): string {
	return typeof value === "string" ? value.toLowerCase() : "";
}

/**
 * The OpenAI-compatible adapter. Construct one per base URL:
 * `new OpenAiCompatibleAdapter(OPENAI_BASE_URL)` for `openai`,
 * `new OpenAiCompatibleAdapter(OPENROUTER_BASE_URL)` for `openrouter`. The
 * `adapterFor` dispatcher (Task 3.2) selects the right base URL by `auth.type`.
 */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
	/** Base URL without a trailing slash. */
	private readonly baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	/** `POST {base}/v1/chat/completions` with a Bearer auth header (Req 6.1). */
	endpoint(auth: LlmAuth): { url: string; headers: Record<string, string> } {
		return {
			url: `${this.baseUrl}/v1/chat/completions`,
			headers: { authorization: `Bearer ${auth.token}` },
		};
	}

	/**
	 * The effective model for the call. `openai`/`openrouter` credentials always
	 * carry the resolved Selected_Model/Default_Model in `auth.model`; when (for
	 * any reason) it is empty, fall back to the caller-provided default.
	 */
	effectiveModel(auth: LlmAuth, fallbackModel: string): string {
		const model =
			"model" in auth && typeof auth.model === "string"
				? auth.model.trim()
				: "";
		return model.length > 0 ? model : fallbackModel;
	}

	/**
	 * Classification request: a forced `decide` *function* tool with the system
	 * prompt as the first message. The `decide` parameter schema and the system
	 * prompt are shared verbatim with the Anthropic path (Req 6.1).
	 */
	buildClassifyBody(model: string, ctx: ChatContext): unknown {
		return {
			model,
			max_tokens: 1024,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: renderContext(ctx) },
			],
			tools: [
				{
					type: "function",
					function: { name: "decide", parameters: DECIDE_PARAMETERS },
				},
			],
			tool_choice: { type: "function", function: { name: "decide" } },
		};
	}

	/** Free-form reply: a plain completion, system prompt as the first message. */
	buildReplyBody(model: string, ctx: ChatContext): unknown {
		return {
			model,
			max_tokens: 4096,
			messages: [
				{ role: "system", content: REPLY_SYSTEM_PROMPT },
				{ role: "user", content: renderContext(ctx) },
			],
		};
	}

	/** Smallest valid probe: one user message capped at a single token (Req 3.1). */
	buildProbeBody(model: string): unknown {
		return {
			model,
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 1,
		};
	}

	/**
	 * Extract the structured intent decision from
	 * `choices[0].message.tool_calls[0].function.arguments` (a JSON string),
	 * `JSON.parse`ing it under a guard and validating against the shared
	 * `intentDecisionSchema`. Returns `null` on any miss — absent path, wrong
	 * type, unparseable JSON, or schema-invalid object (Req 6.4/6.5).
	 */
	extractDecision(body: unknown): IntentDecision | null {
		const args = (
			body as {
				choices?: Array<{
					message?: {
						tool_calls?: Array<{ function?: { arguments?: unknown } }>;
					};
				}>;
			} | null
		)?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

		if (typeof args !== "string") {
			return null;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(args);
		} catch {
			return null;
		}

		const result = intentDecisionSchema.safeParse(parsed);
		return result.success ? result.data : null;
	}

	/** Read the assistant reply from `choices[0].message.content` (Req 6.2). */
	extractReplyText(body: unknown): string {
		const content = (
			body as {
				choices?: Array<{ message?: { content?: unknown } }>;
			} | null
		)?.choices?.[0]?.message?.content;
		return typeof content === "string" ? content.trim() : "";
	}

	/**
	 * OpenAI-compatible providers never encode an error in a 200 body — they use
	 * HTTP status codes — so the shared status ladder governs entirely and this
	 * always returns `false`.
	 */
	isProviderErrorBody(_body: unknown): boolean {
		return false;
	}

	/**
	 * Parse OpenAI-compatible rate-limit headers into the shared `RateLimitInfo`.
	 *
	 *  - `retry-after` (non-negative integer seconds) drives `retryAfterMs` and,
	 *    when present, the `resetTimeMs` (bounded offset from receipt time),
	 *    matching the Anthropic parser's behavior.
	 *  - otherwise `x-ratelimit-reset-requests` is read as epoch seconds
	 *    (OpenRouter exposes an epoch reset; OpenAI's duration form is not an
	 *    integer and is therefore ignored, leaving `resetTimeMs` null).
	 *  - the derived reset is clamped to never precede `receivedAtMs`.
	 *  - `x-ratelimit-limit-requests`, when present, is surfaced (truncated) as
	 *    the human-readable status string.
	 */
	parseRateLimitInfo(args: {
		headers: HeaderGet;
		receivedAtMs: number;
	}): RateLimitInfo {
		const { headers, receivedAtMs } = args;

		const retryAfterSeconds = parseNonNegativeInt(headers("retry-after"));
		const retryAfterMs =
			retryAfterSeconds === null ? null : retryAfterSeconds * 1000;

		let resetTimeMs: number | null = null;
		if (retryAfterSeconds !== null) {
			const bounded = Math.min(retryAfterSeconds, RETRY_AFTER_MAX_SECONDS);
			resetTimeMs = receivedAtMs + bounded * 1000;
		} else {
			const resetEpoch = parseNonNegativeInt(
				headers("x-ratelimit-reset-requests"),
			);
			if (resetEpoch !== null) {
				resetTimeMs = resetEpoch * 1000;
			}
		}

		if (resetTimeMs !== null && resetTimeMs < receivedAtMs) {
			resetTimeMs = receivedAtMs;
		}

		const info: RateLimitInfo = { resetTimeMs, retryAfterMs };

		const statusHeader = headers("x-ratelimit-limit-requests");
		if (statusHeader !== null) {
			info.status = statusHeader.slice(0, STATUS_MAX_CHARS);
		}

		return info;
	}

	/**
	 * Map a model-unknown `400`/`404` response to `true` (Req 10.2). OpenAI
	 * surfaces an unknown model as a `404` with `error.code === "model_not_found"`
	 * (or `error.param === "model"`); OpenRouter surfaces it as a `400`. Any
	 * other status, or a `400/404` whose body does not point at the model, maps
	 * to `false` so the Model_Selector reports "could not be validated" instead
	 * (Req 10.3).
	 */
	isModelUnavailable(status: number, body: unknown): boolean {
		if (status !== 400 && status !== 404) {
			return false;
		}

		const err = (body as { error?: unknown } | null)?.error;
		if (typeof err !== "object" || err === null) {
			// A bare 404 with no parseable error body still strongly implies an
			// unknown model/endpoint for these providers.
			return status === 404;
		}

		const e = err as {
			code?: unknown;
			type?: unknown;
			param?: unknown;
			message?: unknown;
		};
		const code = lowerStr(e.code);
		const param = lowerStr(e.param);
		const message = lowerStr(e.message);

		if (code.includes("model")) {
			return true;
		}
		if (param === "model") {
			return true;
		}
		if (
			message.includes("model") &&
			(message.includes("not found") ||
				message.includes("does not exist") ||
				message.includes("unknown") ||
				message.includes("invalid") ||
				message.includes("unavailable") ||
				message.includes("no such"))
		) {
			return true;
		}
		return false;
	}
}
