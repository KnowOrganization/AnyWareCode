import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FailureMode, LlmCallResult } from "./failures.js";
import { callWithRetry, type RetryPolicy } from "./retry.js";

/**
 * Property-based tests for the bounded single-retry/backoff wrapper (Req 9).
 *
 * Both properties drive `callWithRetry` with a counting `attempt` function and
 * an injected `sleep` recorder so we can observe exactly how many times the
 * call was attempted and what delays were requested — without any real I/O or
 * wall-clock waiting.
 */

const FAILURE_MODES: FailureMode[] = [
	"rate_limited",
	"auth_failed",
	"overloaded",
	"model_error",
	"network_error",
];

/** Build a rate_limited failure result carrying an optional retry-after. */
function rateLimited(retryAfterMs: number | null): LlmCallResult {
	return {
		ok: false,
		failure: {
			mode: "rate_limited",
			httpStatus: 429,
			rateLimitInfo: { resetTimeMs: null, retryAfterMs },
		},
	};
}

/** Build a non-rate-limited failure result for the given mode. */
function failureOf(mode: Exclude<FailureMode, "rate_limited">): LlmCallResult {
	const httpStatus =
		mode === "auth_failed"
			? 401
			: mode === "overloaded"
				? 529
				: mode === "model_error"
					? 400
					: undefined; // network_error has no HTTP status
	return { ok: false, failure: { mode, httpStatus } };
}

/** Arbitrary single LlmCallResult spanning success + every failure mode. */
const anyResultArb: fc.Arbitrary<LlmCallResult> = fc.oneof(
	fc.record({ ok: fc.constant(true as const), body: fc.anything() }),
	fc
		.tuple(
			fc.constantFrom(...FAILURE_MODES),
			fc.option(fc.integer({ min: 0, max: 120_000 }), { nil: null }),
		)
		.map(([mode, retryAfterMs]): LlmCallResult => {
			if (mode === "rate_limited") return rateLimited(retryAfterMs);
			return failureOf(mode);
		}),
);

/**
 * Wrap a sequence of results into a counting attempt fn. Each invocation
 * returns the next result in the sequence; once exhausted it keeps returning
 * the final result so a retry on a repeated rate_limited result is exercised.
 */
function countingAttempt(sequence: LlmCallResult[]): {
	attempt: () => Promise<LlmCallResult>;
	getCalls: () => number;
} {
	let calls = 0;
	const attempt = async (): Promise<LlmCallResult> => {
		const idx = Math.min(calls, sequence.length - 1);
		calls += 1;
		return sequence[idx]!;
	};
	return { attempt, getCalls: () => calls };
}

/** A sleep recorder that captures requested delays and resolves immediately. */
function sleepRecorder(): {
	sleep: (ms: number) => Promise<void>;
	recorded: number[];
} {
	const recorded: number[] = [];
	const sleep = async (ms: number): Promise<void> => {
		recorded.push(ms);
	};
	return { sleep, recorded };
}

describe("callWithRetry", () => {
	// Feature: llm-rate-limit-resilience, Property 13: Retry is bounded to at
	// most one additional attempt (one initial + at most one retry) for ANY
	// result sequence, including repeated rate_limited results. Validates: Requirements 9.1
	it("Property 13: attempt is invoked at most twice for any result sequence", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(anyResultArb, { minLength: 1, maxLength: 6 }),
				fc.integer({ min: 0, max: 30_000 }),
				async (sequence, maxRetryDelayMs) => {
					const { attempt, getCalls } = countingAttempt(sequence);
					const { sleep } = sleepRecorder();
					const policy: RetryPolicy = { maxRetryDelayMs, sleep };

					await callWithRetry(attempt, policy);

					// One initial attempt plus at most one retry (Req 9.1).
					expect(getCalls()).toBeLessThanOrEqual(2);
					expect(getCalls()).toBeGreaterThanOrEqual(1);
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 14: Retry policy honors
	// backoff and skip thresholds across all first-result modes.
	// Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6
	it("Property 14: retry honors backoff, skip thresholds, and no-retry modes", async () => {
		// A distinct second result so we can tell which result was returned.
		const SECOND: LlmCallResult = { ok: true, body: "__second__" };

		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom<FailureMode | "success">(
					"success",
					...FAILURE_MODES,
				),
				fc.option(fc.integer({ min: 0, max: 120_000 }), { nil: null }),
				fc.integer({ min: 0, max: 30_000 }),
				async (firstMode, retryAfterMs, maxRetryDelayMs) => {
					const first: LlmCallResult =
						firstMode === "success"
							? { ok: true, body: "__first__" }
							: firstMode === "rate_limited"
								? rateLimited(retryAfterMs)
								: failureOf(firstMode);

					const { attempt, getCalls } = countingAttempt([first, SECOND]);
					const { sleep, recorded } = sleepRecorder();
					const result = await callWithRetry(attempt, {
						maxRetryDelayMs,
						sleep,
					});

					if (firstMode === "success") {
						// success → no retry, no sleep (decision table).
						expect(getCalls()).toBe(1);
						expect(recorded).toEqual([]);
						expect(result).toBe(first);
						return;
					}

					if (firstMode !== "rate_limited") {
						// auth_failed/model_error → never retry (9.5);
						// overloaded/network_error → no auto-retry (9.6).
						expect(getCalls()).toBe(1);
						expect(recorded).toEqual([]);
						expect(result).toBe(first);
						return;
					}

					// rate_limited branches (9.2, 9.3, 9.4).
					if (retryAfterMs === null) {
						// No retry-after → retry immediately, no sleep (9.3).
						expect(getCalls()).toBe(2);
						expect(recorded).toEqual([]);
						expect(result).toBe(SECOND);
					} else if (retryAfterMs > maxRetryDelayMs) {
						// Wait exceeds the cap → skip retry, no sleep (9.4).
						expect(getCalls()).toBe(1);
						expect(recorded).toEqual([]);
						expect(result).toBe(first);
					} else {
						// retry-after within budget → sleep exactly retryAfterMs,
						// then retry once (9.1, 9.2).
						expect(getCalls()).toBe(2);
						expect(recorded).toEqual([retryAfterMs]);
						expect(result).toBe(SECOND);
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});
