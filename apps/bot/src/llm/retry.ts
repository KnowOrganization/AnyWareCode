/**
 * Bounded single-retry/backoff wrapper for LLM calls (Req 9).
 *
 * `callWithRetry` calls the provided `attempt` once and, only when the result
 * is a `rate_limited` failure, retries at most one additional time. The retry
 * honors the `retry-after` delay via an injectable `sleep`, skips when the
 * required wait exceeds `maxRetryDelayMs`, and retries immediately when no
 * `retry-after` is present. All other outcomes (success, auth_failed,
 * model_error, overloaded, network_error) return immediately with no retry.
 *
 * Pure orchestration: no I/O beyond the injectable `sleep`, no Discord, no DB.
 */

import type { LlmCallResult, LlmFailure } from "./failures.js";

/**
 * The minimal shape `callWithRetry` needs: a discriminated result that is
 * either a success (`ok: true`) or a classified failure carrying `LlmFailure`.
 * `LlmCallResult` satisfies this, as do the chat-path `ClassifyResult` and
 * `ReplyResult` whose success arms carry `decision`/`text` instead of `body`.
 */
export type RetryableResult = { ok: true } | { ok: false; failure: LlmFailure };

export interface RetryPolicy {
	/** Maximum delay we are willing to wait before retrying, in ms.
	 *  Sourced from config RETRY_MAX_DELAY_SECONDS. */
	maxRetryDelayMs: number;
	/** Injectable sleep for deterministic tests. Defaults to a real
	 *  setTimeout-based sleep when not provided. */
	sleep?: (ms: number) => Promise<void>;
}

/** Real wall-clock sleep used when the policy does not inject one. */
function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `attempt` once; on a `rate_limited` result, retries at most once,
 * honoring retry-after, skipping if the wait exceeds `maxRetryDelayMs`.
 * Never retries auth_failed/model_error; never auto-retries
 * overloaded/network_error. Returns the final result of the wrapped attempt,
 * preserving its concrete type (e.g. {@link LlmCallResult}, `ClassifyResult`,
 * or `ReplyResult`).
 */
export async function callWithRetry<T extends RetryableResult>(
	attempt: () => Promise<T>,
	policy: RetryPolicy,
): Promise<T> {
	const first = await attempt();

	// success → return immediately (Req 9 decision table).
	if (first.ok) return first;

	// Only rate_limited is retryable; everything else returns immediately
	// (auth_failed/model_error never retry — 9.5; overloaded/network_error
	// no auto-retry — 9.6).
	if (first.failure.mode !== "rate_limited") return first;

	const retryAfterMs = first.failure.rateLimitInfo?.retryAfterMs ?? null;

	if (retryAfterMs !== null) {
		// retry-after present but the wait exceeds our cap → skip retry (9.4).
		if (retryAfterMs > policy.maxRetryDelayMs) return first;
		// retry-after within budget → sleep then retry once (9.1, 9.2).
		const sleep = policy.sleep ?? defaultSleep;
		await sleep(retryAfterMs);
	}
	// No retry-after → retry once immediately (9.3).

	return attempt();
}
