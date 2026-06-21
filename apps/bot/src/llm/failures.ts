/**
 * Shared failure data models for the LLM rate-limit resilience feature.
 *
 * This module holds the shared types plus the classifier, header parser, and
 * the failure logger. It avoids Discord and DB dependencies; the only runtime
 * import is the shared pino `log`, used solely by `logFailure` (the designated
 * logging function for Req 10). The `LlmAuth` type from the credentials module
 * is imported to constrain the provider-type field.
 */

import { log } from "../observability.js";
import type { LlmAuth } from "./credentials.js";

/** Wall-clock instant the classifier ran against (epoch ms). Injected so
 *  Reset_Time derivation and clamping are deterministic in tests. */
export interface ClassifyClock {
	nowMs: number;
}

/** Minimal header view — case-insensitive getter, matching fetch Headers. */
export type HeaderGet = (name: string) => string | null;

/** The five non-success categories (Req 1.10) — mutually exclusive, exhaustive. */
export type FailureMode =
	| "rate_limited"
	| "auth_failed"
	| "overloaded"
	| "model_error"
	| "network_error";

/** Recovery metadata extracted from a 429 response (Req 2). */
export interface RateLimitInfo {
	/** Reset_Time as epoch ms, or null when unknown (Req 2.5). Always ≥ receivedAtMs (Req 2.6). */
	resetTimeMs: number | null;
	/** retry-after in ms when present (drives backoff in retry.ts; Req 9.2/9.3). */
	retryAfterMs: number | null;
	/** anthropic-ratelimit-unified-status, capped at 256 chars (Req 2.4). */
	status?: string;
}

/** A classified non-success outcome. */
export interface LlmFailure {
	mode: FailureMode;
	/** HTTP status when one was received; absent for network_error (Req 10.2). */
	httpStatus?: number;
	/** Present only when mode === "rate_limited". */
	rateLimitInfo?: RateLimitInfo;
	/** Short, secret-free diagnostic for logs (never the token/auth header). */
	detail?: string;
}

/** The single result type every LLM call resolves to. */
export type LlmCallResult =
	| { ok: true; body: unknown } // probe success carries the parsed body
	| { ok: false; failure: LlmFailure };

/** Structured-log fields for a failure (Req 10). Token/auth header NEVER included. */
export interface FailureLogFields {
	guildId: string;
	providerType: LlmAuth["type"] | "unknown";
	model: string;
}

/**
 * Detect a provider error indicator in a 200-status body. Anthropic returns
 * `{ "type": "error", ... }` for some soft errors even on HTTP 200, which must
 * be treated as `model_error` (Req 1.7).
 */
function isProviderErrorBody(body: unknown): boolean {
	return (
		typeof body === "object" &&
		body !== null &&
		(body as { type?: unknown }).type === "error"
	);
}

/**
 * Classify a completed HTTP response into exactly one `LlmCallResult`
 * (Req 1.1–1.8, 1.10).
 *
 * The mapping is a total `if/else if` ladder over disjoint status ranges with
 * an unconditional final `model_error` arm, so every received status yields
 * exactly one outcome:
 *
 * | Condition                                   | Result                |
 * |---------------------------------------------|-----------------------|
 * | 200 + conformant body                       | success               |
 * | 200 + non-conformant / provider error body  | model_error  (1.7)    |
 * | 429                                         | rate_limited (1.1)    |
 * | 401, 403                                    | auth_failed  (1.2)    |
 * | 529                                         | overloaded   (1.3)    |
 * | 500–599 except 529                          | overloaded   (1.4)    |
 * | 400–499 except 401/403/429                  | model_error  (1.5)    |
 * | any other received status                   | model_error  (1.8)    |
 *
 * `validate` is a path-specific conformance predicate: the classify path checks
 * for a `decide` tool_use block and the reply path checks for a non-empty text
 * block. When omitted, any 200 body that is not a provider error is treated as
 * conformant.
 *
 * `isProviderError` is the adapter-supplied soft-error detector for the 200
 * path. It defaults to the Anthropic `{type:"error"}` check so existing callers
 * (and the probe) keep their behavior; the OpenAI-compatible adapter passes a
 * predicate that always returns `false` (those providers signal errors via HTTP
 * status, so the status ladder governs entirely).
 */
export function classifyResponse(args: {
	status: number;
	headers: HeaderGet;
	body: unknown;
	receivedAtMs: number;
	validate?: (body: unknown) => boolean;
	isProviderError?: (body: unknown) => boolean;
}): LlmCallResult {
	const { status, headers, body, receivedAtMs, validate } = args;
	const isProviderError = args.isProviderError ?? isProviderErrorBody;

	// 200: success only when the body is conformant and not a provider error.
	if (status === 200) {
		const conformant =
			!isProviderError(body) && (validate ? validate(body) : true);
		if (conformant) {
			return { ok: true, body };
		}
		return {
			ok: false,
			failure: {
				mode: "model_error",
				httpStatus: status,
				detail: "200 response with non-conformant body",
			},
		};
	}

	// 429 → rate_limited, with recovery metadata parsed from the headers.
	if (status === 429) {
		return {
			ok: false,
			failure: {
				mode: "rate_limited",
				httpStatus: status,
				rateLimitInfo: parseRateLimitInfo({ headers, receivedAtMs }),
			},
		};
	}

	// 401/403 → auth_failed.
	if (status === 401 || status === 403) {
		return {
			ok: false,
			failure: { mode: "auth_failed", httpStatus: status },
		};
	}

	// 529 and the rest of 5xx → overloaded.
	if (status === 529 || (status >= 500 && status <= 599)) {
		return {
			ok: false,
			failure: { mode: "overloaded", httpStatus: status },
		};
	}

	// Remaining 4xx (401/403/429 already handled above) → model_error.
	if (status >= 400 && status <= 499) {
		return {
			ok: false,
			failure: { mode: "model_error", httpStatus: status },
		};
	}

	// Any other received status → model_error (unconditional final arm).
	return {
		ok: false,
		failure: { mode: "model_error", httpStatus: status },
	};
}

/**
 * Classify a thrown transport error — a failure that occurred before any HTTP
 * status was received (connection refused/reset, DNS failure, TLS handshake
 * failure, no-response timeout). Always `network_error` (Req 1.9). No HTTP
 * status is attached because none was received (Req 10.2).
 */
export function classifyTransportError(
	_err: unknown,
): LlmFailure & { mode: "network_error" } {
	return { mode: "network_error" };
}

/** Maximum value (256 chars) of the unified-status field kept in Rate_Limit_Info. */
const STATUS_MAX_CHARS = 256;
/** Upper bound (seconds) applied to a `retry-after` value before use (Req 2.3). */
const RETRY_AFTER_MAX_SECONDS = 86400;

/**
 * Strictly parse a header value as a non-negative integer (Req 2.1–2.3).
 *
 * A value is accepted only when, after trimming surrounding whitespace, it is a
 * non-empty string composed solely of decimal digits. Negative, non-numeric,
 * empty, fractional, and otherwise malformed values are rejected (returns null),
 * causing the caller to treat the header as absent.
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

/**
 * Parse Anthropic rate-limit headers into Rate_Limit_Info (Req 2).
 *
 * Algorithm:
 *  1. `anthropic-ratelimit-unified-reset` as a non-negative integer (epoch
 *     seconds) → `resetTimeMs = value * 1000` (Req 2.1). Otherwise treat the
 *     header as absent and fall through (Req 2.2).
 *  2. On fallthrough, `retry-after` as a non-negative integer (seconds), bounded
 *     to `[0, 86400]` → `resetTimeMs = receivedAtMs + bounded * 1000` (Req 2.3).
 *  3. If neither is usable, `resetTimeMs = null` (Req 2.5).
 *  4. If the derived `resetTimeMs` is earlier than `receivedAtMs`, clamp it up to
 *     `receivedAtMs` (Req 2.6).
 *  5. `anthropic-ratelimit-unified-status`, when present, is included truncated
 *     to 256 chars (Req 2.4).
 *
 * `retryAfterMs` is derived from the `retry-after` header only (non-negative
 * integer seconds → ms), independent of whether `unified-reset` was present, so
 * backoff (retry.ts, Req 9.2/9.3) always has the raw retry-after when supplied.
 */
export function parseRateLimitInfo(args: {
	headers: HeaderGet;
	receivedAtMs: number;
}): RateLimitInfo {
	const { headers, receivedAtMs } = args;

	// retry-after drives backoff regardless of unified-reset (Req 9.2/9.3).
	const retryAfterSeconds = parseNonNegativeInt(headers("retry-after"));
	const retryAfterMs =
		retryAfterSeconds === null ? null : retryAfterSeconds * 1000;

	// 1) Prefer unified-reset (epoch seconds).
	let resetTimeMs: number | null = null;
	const unifiedReset = parseNonNegativeInt(
		headers("anthropic-ratelimit-unified-reset"),
	);
	if (unifiedReset !== null) {
		resetTimeMs = unifiedReset * 1000;
	} else if (retryAfterSeconds !== null) {
		// 2) Fall through to a bounded retry-after offset from receipt time.
		const bounded = Math.min(retryAfterSeconds, RETRY_AFTER_MAX_SECONDS);
		resetTimeMs = receivedAtMs + bounded * 1000;
	}

	// 4) Never report a Reset_Time earlier than the receipt time (Req 2.6).
	if (resetTimeMs !== null && resetTimeMs < receivedAtMs) {
		resetTimeMs = receivedAtMs;
	}

	const info: RateLimitInfo = { resetTimeMs, retryAfterMs };

	// 5) Include the unified-status, truncated to 256 chars, when present.
	const statusHeader = headers("anthropic-ratelimit-unified-status");
	if (statusHeader !== null) {
		info.status = statusHeader.slice(0, STATUS_MAX_CHARS);
	}

	return info;
}

/** A structured-log sink: `(fields, message)`. Mirrors pino's `log.warn` shape
 *  so the real logger can be used directly while tests inject a spy. */
export type FailureLogSink = (
	obj: Record<string, unknown>,
	msg: string,
) => void;

/** Default sink — routes to the shared pino logger at warn level. */
const defaultSink: FailureLogSink = (obj, msg) => log.warn(obj, msg);

/**
 * Emit exactly one Structured_Log entry for a classified LLM failure (Req 10).
 *
 * The entry always carries the Failure_Mode, requested Model_Tier, guild
 * identifier, and provider type (Req 10.1, 10.6). When an HTTP status was
 * received it is included (Req 10.2). For a `rate_limited` failure with a known
 * Reset_Time, the reset instant is included (Req 10.3). Exactly one sink call is
 * made per invocation (Req 10.4).
 *
 * By construction the function only ever receives the secret-free `LlmFailure`
 * and `FailureLogFields` — no token or authorization header is in scope at the
 * call site, so the emitted entry can never contain one (Req 10.5).
 *
 * `sink` is injectable purely for testing the log shape; it defaults to the
 * shared pino logger.
 */
export function logFailure(
	failure: LlmFailure,
	fields: FailureLogFields,
	sink: FailureLogSink = defaultSink,
): void {
	const entry: Record<string, unknown> = {
		mode: failure.mode,
		model: fields.model,
		guildId: fields.guildId,
		providerType: fields.providerType,
	};

	// Include the HTTP status whenever one was received (Req 10.2).
	if (failure.httpStatus !== undefined) {
		entry.httpStatus = failure.httpStatus;
	}

	// Include the Reset_Time for a rate_limited failure with a known reset (Req 10.3).
	if (
		failure.mode === "rate_limited" &&
		failure.rateLimitInfo?.resetTimeMs != null
	) {
		entry.resetTimeMs = failure.rateLimitInfo.resetTimeMs;
	}

	// Exactly one entry per call (Req 10.4).
	sink(entry, "llm_failure");
}

/**
 * Issue a single, minimal Messages-API probe against a model and classify the
 * outcome (Req 1.9, 5.7, 11.2).
 *
 * The probe sends `max_tokens: 1` with a trivial user message — just enough to
 * elicit a real provider response (200, 429, 401/403, 5xx, …) without incurring
 * meaningful token cost. The request runs under an `AbortController` bounded by
 * `timeoutMs`; if the deadline elapses, the in-flight fetch is aborted and the
 * resulting thrown error is classified as a transport (network) failure.
 *
 * Outcome handling is delegated wholesale to the shared classifiers so the probe
 * shares one mapping with the rest of the feature:
 *  - any thrown error (including an abort/timeout) → `classifyTransportError`
 *    (Req 1.9).
 *  - any completed response → `classifyResponse` with NO `validate` predicate:
 *    a probe only needs a 200 with a non-error body to count as success.
 *
 * This function NEVER throws — it always resolves to an `LlmCallResult`. The
 * abort timer is always cleared in `finally`.
 *
 * `fetchFn` and `nowMs` are injectable for deterministic testing; they default
 * to the global `fetch` and `Date.now`.
 */
export async function probeModel(args: {
	auth: LlmAuth;
	model: string;
	fetchFn?: typeof fetch;
	timeoutMs: number;
	nowMs?: () => number;
}): Promise<LlmCallResult> {
	const { auth, model, timeoutMs } = args;
	const fetchFn = args.fetchFn ?? fetch;
	const nowMs = args.nowMs ?? (() => Date.now());

	// Adapter-aware request construction: the endpoint, auth headers, effective
	// model, and probe body all come from the provider adapter so OpenAI-compatible
	// providers probe `/v1/chat/completions` and Anthropic types `/v1/messages`.
	// Lazy import avoids the providers→chat→failures init cycle (see credentials.ts).
	const { adapterFor } = await import("./providers/index.js");
	const adapter = adapterFor(auth);
	const { url, headers } = adapter.endpoint(auth);
	const body = JSON.stringify(
		adapter.buildProbeBody(adapter.effectiveModel(auth, model)),
	);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetchFn(url, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body,
			signal: controller.signal,
		});

		// Capture the receipt instant before any further async work so
		// Reset_Time derivation is anchored to when the response arrived.
		const receivedAtMs = nowMs();

		// Guard the JSON parse: an unparseable body becomes `null`, which the
		// classifier treats as a non-conformant 200 (model_error) or simply as
		// the (ignored) body for non-200 statuses.
		let parsed: unknown = null;
		try {
			parsed = await res.json();
		} catch {
			parsed = null;
		}

		return classifyResponse({
			status: res.status,
			headers: (n) => res.headers.get(n),
			body: parsed,
			receivedAtMs,
		});
	} catch (err) {
		// Thrown before a status was received (connection failure, abort/timeout,
		// DNS/TLS error) → always network_error (Req 1.9).
		return { ok: false, failure: classifyTransportError(err) };
	} finally {
		clearTimeout(timer);
	}
}
