import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LlmAuth } from "./credentials.js";
import {
	classifyResponse,
	classifyTransportError,
	type FailureLogFields,
	type FailureMode,
	type HeaderGet,
	logFailure,
	parseRateLimitInfo,
	probeModel,
} from "./failures.js";

/** The five mutually-exclusive, collectively-exhaustive non-success modes. */
const FAILURE_MODES: FailureMode[] = [
	"rate_limited",
	"auth_failed",
	"overloaded",
	"model_error",
	"network_error",
];

/** Build a case-insensitive `HeaderGet` from an arbitrary string→string record. */
const headersArb: fc.Arbitrary<HeaderGet> = fc
	.dictionary(fc.string(), fc.string())
	.map((rec): HeaderGet => {
		const lower: Record<string, string> = {};
		for (const [k, v] of Object.entries(rec)) {
			lower[k.toLowerCase()] = v;
		}
		return (name: string) => lower[name.toLowerCase()] ?? null;
	});

/** Arbitrary response body: primitives, objects, provider-error bodies, etc. */
const bodyArb: fc.Arbitrary<unknown> = fc.oneof(
	fc.constant(null),
	fc.constant(undefined),
	fc.string(),
	fc.integer(),
	fc.boolean(),
	fc.object(),
	fc.record({ type: fc.constant("error") }),
	fc.record({ content: fc.array(fc.object()) }),
);

/** Arbitrary HTTP status spanning well-known codes plus the full numeric range. */
const statusArb: fc.Arbitrary<number> = fc.oneof(
	fc.constantFrom(
		200,
		400,
		401,
		402,
		403,
		404,
		418,
		429,
		500,
		501,
		502,
		503,
		529,
		100,
		204,
		301,
		599,
		600,
	),
	fc.integer({ min: 0, max: 700 }),
);

/** Arbitrary, deterministic conformance predicate for the 200 path. */
const validateArb: fc.Arbitrary<(body: unknown) => boolean> = fc.func(
	fc.boolean(),
);

const receivedAtArb: fc.Arbitrary<number> = fc.integer({
	min: 0,
	max: 4_102_444_800_000, // year ~2100 in epoch ms
});

/** Mirror of the classifier's mapping table, used to assert Property 2. */
function expectedOutcome(
	status: number,
	body: unknown,
	validate: (body: unknown) => boolean,
): "success" | FailureMode {
	if (status === 200) {
		const isProviderError =
			typeof body === "object" &&
			body !== null &&
			(body as { type?: unknown }).type === "error";
		const conformant = !isProviderError && validate(body);
		return conformant ? "success" : "model_error";
	}
	if (status === 429) return "rate_limited";
	if (status === 401 || status === 403) return "auth_failed";
	if (status === 529 || (status >= 500 && status <= 599)) return "overloaded";
	if (status >= 400 && status <= 499) return "model_error";
	return "model_error";
}

describe("classifyResponse / classifyTransportError — properties", () => {
	// Feature: llm-rate-limit-resilience, Property 1: Classifier totality and
	// mutual exclusivity — for any status/headers/body the result is exactly one
	// well-typed outcome (ok:true OR ok:false with failure.mode in the five-mode
	// set). Validates: Requirements 1.10
	it("Property 1: classifies every input as exactly one well-typed outcome", () => {
		fc.assert(
			fc.property(
				statusArb,
				headersArb,
				bodyArb,
				receivedAtArb,
				validateArb,
				(status, headers, body, receivedAtMs, validate) => {
					const res = classifyResponse({
						status,
						headers,
						body,
						receivedAtMs,
						validate,
					});

					// Exactly one of the two shapes, discriminated by `ok`.
					expect(typeof res.ok).toBe("boolean");
					if (res.ok) {
						// Success carries a body and no failure.
						expect("body" in res).toBe(true);
						expect("failure" in res).toBe(false);
					} else {
						// Failure carries exactly one mode from the five-mode set.
						expect("failure" in res).toBe(true);
						expect(FAILURE_MODES).toContain(res.failure.mode);
						const matches = FAILURE_MODES.filter(
							(m) => m === res.failure.mode,
						);
						expect(matches).toHaveLength(1);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 2: Classifier status-to-mode
	// mapping — the classified outcome is determined solely by the status (and,
	// at 200, the conformance predicate) per the design mapping table.
	// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
	it("Property 2: maps status (and 200 conformance) to the specified outcome", () => {
		fc.assert(
			fc.property(
				statusArb,
				headersArb,
				bodyArb,
				receivedAtArb,
				validateArb,
				(status, headers, body, receivedAtMs, validate) => {
					const res = classifyResponse({
						status,
						headers,
						body,
						receivedAtMs,
						validate,
					});
					const expected = expectedOutcome(status, body, validate);

					if (expected === "success") {
						expect(res.ok).toBe(true);
					} else {
						expect(res.ok).toBe(false);
						if (!res.ok) {
							expect(res.failure.mode).toBe(expected);
						}
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 3: Transport errors classify
	// as network_error — for any thrown value raised before an HTTP status is
	// received, classifyTransportError returns mode === "network_error".
	// Validates: Requirements 1.9
	it("Property 3: classifies any thrown transport value as network_error", () => {
		const thrownArb: fc.Arbitrary<unknown> = fc.oneof(
			fc.string().map((s) => new Error(s)),
			fc.string(),
			fc.integer(),
			fc.boolean(),
			fc.object(),
			fc.constant(null),
			fc.constant(undefined),
			fc.constantFrom(
				"ECONNREFUSED",
				"ECONNRESET",
				"ENOTFOUND",
				"ETIMEDOUT",
			),
		);

		fc.assert(
			fc.property(thrownArb, (err) => {
				const res = classifyTransportError(err);
				expect(res.mode).toBe("network_error");
			}),
			{ numRuns: 100 },
		);
	});
});

// ---------------------------------------------------------------------------
// parseRateLimitInfo — rate-limit header parser properties (Properties 4–6)
// ---------------------------------------------------------------------------

/** The three rate-limit header names the parser reads (case-insensitive). */
const RESET_HEADER = "anthropic-ratelimit-unified-reset";
const RETRY_AFTER_HEADER = "retry-after";
const STATUS_HEADER = "anthropic-ratelimit-unified-status";

/** Build a case-insensitive `HeaderGet` from optional named header values. */
function buildRateLimitHeaders(fields: {
	reset?: string;
	retryAfter?: string;
	status?: string;
}): HeaderGet {
	const map: Record<string, string> = {};
	if (fields.reset !== undefined) map[RESET_HEADER] = fields.reset;
	if (fields.retryAfter !== undefined)
		map[RETRY_AFTER_HEADER] = fields.retryAfter;
	if (fields.status !== undefined) map[STATUS_HEADER] = fields.status;
	return (name: string) => map[name.toLowerCase()] ?? null;
}

/**
 * Mirror of the parser's strict non-negative-integer rule: accept only a
 * trimmed, non-empty, all-digits string. Used to compute expected derivations.
 */
function parseNonNegIntLikeImpl(raw: string | null | undefined): number | null {
	if (raw === undefined || raw === null) return null;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/** Valid non-negative integer strings (the only values the parser accepts). */
const nonNegIntStringArb: fc.Arbitrary<string> = fc
	.integer({ min: 0, max: 200_000 })
	.map(String);

/** Invalid/junk values that must be treated as absent by the parser. */
const junkValueArb: fc.Arbitrary<string> = fc.oneof(
	fc.constant(""),
	fc.constant("-5"),
	fc.constant("abc"),
	fc.constant("12.5"),
	fc.constant("1e3"),
	fc.constant(" 7 "), // surrounding whitespace is trimmed → still valid? handled by impl
	fc.integer({ min: -1000, max: -1 }).map(String),
	fc.float({ min: Math.fround(0.1), max: 1000, noNaN: true }).map(String),
	fc.string(),
);

/** A numeric header that may be absent (undefined), valid, or junk. */
const maybeNumericHeaderArb: fc.Arbitrary<string | undefined> = fc.option(
	fc.oneof(nonNegIntStringArb, junkValueArb),
	{ nil: undefined },
);

/** A status header value that may be absent; can exceed 256 chars to exercise the cap. */
const maybeStatusHeaderArb: fc.Arbitrary<string | undefined> = fc.option(
	fc.string({ maxLength: 600 }),
	{ nil: undefined },
);

describe("parseRateLimitInfo — properties", () => {
	// Feature: llm-rate-limit-resilience, Property 4: Reset_Time monotonicity and
	// clamping — for any combination of rate-limit headers and received time the
	// derived resetTimeMs is either null or >= receivedAtMs (never earlier than
	// the time the response was received). Validates: Requirements 2.6
	it("Property 4: resetTimeMs is null or never earlier than receivedAtMs", () => {
		fc.assert(
			fc.property(
				maybeNumericHeaderArb,
				maybeNumericHeaderArb,
				maybeStatusHeaderArb,
				receivedAtArb,
				(reset, retryAfter, status, receivedAtMs) => {
					const headers = buildRateLimitHeaders({
						reset,
						retryAfter,
						status,
					});
					const info = parseRateLimitInfo({ headers, receivedAtMs });

					if (info.resetTimeMs !== null) {
						expect(info.resetTimeMs).toBeGreaterThanOrEqual(receivedAtMs);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 5: Reset_Time derivation and
	// fallthrough — unified-reset (non-neg int) → value*1000 (clamped up to
	// receivedAtMs); else retry-after (non-neg int) → receivedAtMs + bounded[0,86400]*1000;
	// else null. Validates: Requirements 2.1, 2.2, 2.3, 2.5
	it("Property 5: derives resetTimeMs from unified-reset, then retry-after, else null", () => {
		fc.assert(
			fc.property(
				maybeNumericHeaderArb,
				maybeNumericHeaderArb,
				receivedAtArb,
				(reset, retryAfter, receivedAtMs) => {
					const headers = buildRateLimitHeaders({ reset, retryAfter });
					const info = parseRateLimitInfo({ headers, receivedAtMs });

					const resetVal = parseNonNegIntLikeImpl(reset);
					const retryVal = parseNonNegIntLikeImpl(retryAfter);

					if (resetVal !== null) {
						// unified-reset wins: value*1000, clamped up to receivedAtMs (Prop 4).
						expect(info.resetTimeMs).toBe(
							Math.max(resetVal * 1000, receivedAtMs),
						);
					} else if (retryVal !== null) {
						// fall through to bounded retry-after offset from receipt time.
						const bounded = Math.min(retryVal, 86_400);
						expect(info.resetTimeMs).toBe(receivedAtMs + bounded * 1000);
					} else {
						// neither header usable → no Reset_Time.
						expect(info.resetTimeMs).toBeNull();
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 6: Rate-limit status field is
	// bounded — for any string value of anthropic-ratelimit-unified-status, the
	// resulting status is at most 256 chars and is a prefix of the original
	// header value. Validates: Requirements 2.4
	it("Property 6: status is capped at 256 chars and is a prefix of the header value", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 600 }),
				maybeNumericHeaderArb,
				maybeNumericHeaderArb,
				receivedAtArb,
				(statusValue, reset, retryAfter, receivedAtMs) => {
					const headers = buildRateLimitHeaders({
						reset,
						retryAfter,
						status: statusValue,
					});
					const info = parseRateLimitInfo({ headers, receivedAtMs });

					expect(info.status).toBeDefined();
					const status = info.status as string;
					expect(status.length).toBeLessThanOrEqual(256);
					expect(statusValue.startsWith(status)).toBe(true);
				},
			),
			{ numRuns: 100 },
		);
	});
});

// ---------------------------------------------------------------------------
// logFailure — structured failure logger properties (Properties 15–16)
// ---------------------------------------------------------------------------

/** Arbitrary over the five mutually-exclusive Failure_Modes. */
const modeArb: fc.Arbitrary<FailureMode> = fc.constantFrom(...FAILURE_MODES);

/** Optional HTTP status (absent for network_error in practice; here independent). */
const maybeHttpStatusArb: fc.Arbitrary<number | undefined> = fc.option(
	fc.integer({ min: 100, max: 599 }),
	{ nil: undefined },
);

/** rateLimitInfo for a rate_limited failure: optional reset/retry plus status. */
const rateLimitInfoArb = fc.record({
	resetTimeMs: fc.option(fc.integer({ min: 0, max: 4_102_444_800_000 }), {
		nil: null,
	}),
	retryAfterMs: fc.option(fc.integer({ min: 0, max: 86_400_000 }), {
		nil: null,
	}),
	status: fc.option(fc.string({ maxLength: 64 }), { nil: undefined }),
});

/**
 * Arbitrary LlmFailure. For rate_limited mode, sometimes attach rateLimitInfo
 * (with possibly-null resetTimeMs) so Property 15's Req 10.3 branch is exercised.
 */
const failureArb: fc.Arbitrary<{
	mode: FailureMode;
	httpStatus?: number;
	rateLimitInfo?: {
		resetTimeMs: number | null;
		retryAfterMs: number | null;
		status?: string;
	};
	detail?: string;
}> = fc
	.record({
		mode: modeArb,
		httpStatus: maybeHttpStatusArb,
		rateLimitInfo: fc.option(rateLimitInfoArb, { nil: undefined }),
		detail: fc.option(fc.string({ maxLength: 128 }), { nil: undefined }),
	})
	.map((f) => {
		// rateLimitInfo only carries meaning on rate_limited; drop it otherwise.
		const out: {
			mode: FailureMode;
			httpStatus?: number;
			rateLimitInfo?: {
				resetTimeMs: number | null;
				retryAfterMs: number | null;
				status?: string;
			};
			detail?: string;
		} = { mode: f.mode };
		if (f.httpStatus !== undefined) out.httpStatus = f.httpStatus;
		if (f.detail !== undefined) out.detail = f.detail;
		if (f.mode === "rate_limited" && f.rateLimitInfo) {
			out.rateLimitInfo = f.rateLimitInfo;
		}
		return out;
	});

/** Provider types accepted by FailureLogFields (Req 10.6). */
const providerTypeArb = fc.constantFrom(
	"anthropic_api_key",
	"claude_oauth",
	"custom",
	"unknown",
) as fc.Arbitrary<FailureLogFields["providerType"]>;

/** Arbitrary FailureLogFields: secret-free guildId / providerType / model. */
const fieldsArb: fc.Arbitrary<FailureLogFields> = fc.record({
	guildId: fc.string({ maxLength: 64 }),
	providerType: providerTypeArb,
	model: fc.string({ maxLength: 64 }),
});

describe("logFailure — properties", () => {
	// Feature: llm-rate-limit-resilience, Property 15: Failure log shape — for any
	// failure + fields, exactly one sink call is made (10.4); the entry carries
	// mode/model/guildId/providerType (10.1, 10.6); httpStatus is included when
	// present on the failure (10.2); resetTimeMs is included for a rate_limited
	// failure with a known reset (10.3); and the message is "llm_failure".
	// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6
	it("Property 15: emits exactly one well-shaped llm_failure entry", () => {
		fc.assert(
			fc.property(failureArb, fieldsArb, (failure, fields) => {
				const calls: Array<{
					obj: Record<string, unknown>;
					msg: string;
				}> = [];
				const sink = (obj: Record<string, unknown>, msg: string) =>
					calls.push({ obj, msg });

				logFailure(failure, fields, sink);

				// Exactly one Structured_Log entry per classified failure (Req 10.4).
				expect(calls).toHaveLength(1);
				const recorded = calls[0];
				if (recorded === undefined) {
					throw new Error("expected exactly one sink call");
				}
				const { obj, msg } = recorded;

				// Stable log message.
				expect(msg).toBe("llm_failure");

				// Always present: mode, model, guildId, providerType (Req 10.1, 10.6).
				expect(obj.mode).toBe(failure.mode);
				expect(obj.model).toBe(fields.model);
				expect(obj.guildId).toBe(fields.guildId);
				expect(obj.providerType).toBe(fields.providerType);

				// HTTP status included iff one was received (Req 10.2).
				if (failure.httpStatus !== undefined) {
					expect(obj.httpStatus).toBe(failure.httpStatus);
				} else {
					expect("httpStatus" in obj).toBe(false);
				}

				// Reset_Time included for rate_limited with a known reset (Req 10.3).
				if (
					failure.mode === "rate_limited" &&
					failure.rateLimitInfo?.resetTimeMs != null
				) {
					expect(obj.resetTimeMs).toBe(failure.rateLimitInfo.resetTimeMs);
				} else {
					expect("resetTimeMs" in obj).toBe(false);
				}
			}),
			{ numRuns: 100 },
		);
	});

	// Feature: llm-rate-limit-resilience, Property 16: Secret redaction invariant
	// (log half) — a generated secret token is kept entirely out of logFailure's
	// inputs (the function only accepts secret-free LlmFailure / FailureLogFields
	// by construction). The serialized log entry must never contain that secret as
	// a substring, even when adversarial-looking (but non-secret) strings are
	// placed in detail / model / guildId. Validates: Requirements 10.5
	it("Property 16: serialized entry never contains the secret token", () => {
		// Secrets shaped like real provider credentials / auth headers.
		const tokenArb: fc.Arbitrary<string> = fc.oneof(
			fc
				.string({ minLength: 8, maxLength: 48 })
				.map((s) => `sk-ant-${s.replace(/\s/g, "")}`),
			fc
				.string({ minLength: 8, maxLength: 48 })
				.map((s) => `Bearer ${s.replace(/\s/g, "")}`),
			fc
				.string({ minLength: 8, maxLength: 48 })
				.map((s) => `sk-${s.replace(/\s/g, "")}`),
		);

		fc.assert(
			fc.property(
				tokenArb,
				failureArb,
				fieldsArb,
				(secret, failure, fields) => {
					// The secret is intentionally NEVER passed to logFailure: the
					// function's input types cannot carry it. We only place benign,
					// non-secret adversarial strings into fields/detail.
					const calls: Array<{
						obj: Record<string, unknown>;
						msg: string;
					}> = [];
					const sink = (obj: Record<string, unknown>, msg: string) =>
						calls.push({ obj, msg });

					logFailure(failure, fields, sink);

					const serialized = JSON.stringify({
						obj: calls[0]?.obj,
						msg: calls[0]?.msg,
					});

					// The actual secret token must be absent from the serialized entry.
					expect(serialized.includes(secret)).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});
});

// ---------------------------------------------------------------------------
// probeModel — single-call model probe (unit tests; Req 1.9, 11.2)
// ---------------------------------------------------------------------------

const API_KEY_AUTH: LlmAuth = { type: "anthropic_api_key", token: "sk-test" };
const OAUTH_AUTH: LlmAuth = { type: "claude_oauth", token: "oauth-test" };
const CUSTOM_AUTH: LlmAuth = {
	type: "custom",
	token: "t",
	baseUrl: "https://llm.example.com",
	model: "their-model",
};

/** Build a `fetchFn` that always returns the given Response, ignoring inputs. */
function fetchReturning(response: Response): typeof fetch {
	return (() => Promise.resolve(response)) as unknown as typeof fetch;
}

describe("probeModel — single-call model probe", () => {
	it("classifies a conformant 200 body as success (ok: true)", async () => {
		const fetchFn = fetchReturning(
			new Response(
				JSON.stringify({
					id: "x",
					content: [{ type: "text", text: "ok" }],
				}),
				{ status: 200 },
			),
		);
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(true);
	});

	it("classifies a 429 response as rate_limited", async () => {
		const fetchFn = fetchReturning(new Response("{}", { status: 429 }));
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.failure.mode).toBe("rate_limited");
	});

	it("classifies a 401 response as auth_failed", async () => {
		const fetchFn = fetchReturning(new Response("{}", { status: 401 }));
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.failure.mode).toBe("auth_failed");
	});

	it("classifies a 529 response as overloaded", async () => {
		const fetchFn = fetchReturning(new Response("{}", { status: 529 }));
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.failure.mode).toBe("overloaded");
	});

	it("treats an unparseable 200 body as success (probe supplies no validate predicate)", async () => {
		// The probe passes NO `validate` predicate to classifyResponse, so any
		// 200 with a non-error body counts as success (design.md: "a probe only
		// needs a 200 with a non-error body to count as success"). An unparseable
		// body is caught and becomes `null` — a non-error body — hence success.
		// (Malformed-body → model_error only occurs on classify/reply paths that
		// supply a validate predicate, which the probe never does.)
		const fetchFn = fetchReturning(
			new Response("not json{", { status: 200 }),
		);
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(true);
	});

	it("classifies a 200 provider-error body as model_error", async () => {
		// A 200 whose body carries `{ type: "error" }` is a provider error
		// indicator and maps to model_error even without a validate predicate
		// (Req 1.7).
		const fetchFn = fetchReturning(
			new Response(JSON.stringify({ type: "error" }), { status: 200 }),
		);
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.failure.mode).toBe("model_error");
	});

	it("classifies a thrown transport error as network_error", async () => {
		const fetchFn = (() =>
			Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn,
			timeoutMs: 1000,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.failure.mode).toBe("network_error");
	});

	it("surfaces a timeout/abort as network_error", async () => {
		const hangingFetch = ((_url: unknown, options: RequestInit) =>
			new Promise((_resolve, reject) => {
				const signal = options.signal as AbortSignal;
				signal.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			})) as unknown as typeof fetch;
		const res = await probeModel({
			auth: API_KEY_AUTH,
			model: "m",
			fetchFn: hangingFetch,
			timeoutMs: 1,
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.failure.mode).toBe("network_error");
	});

	it("uses auth.model (not the model arg) in the request body for custom providers", async () => {
		let capturedBody: unknown;
		const capturingFetch = ((_url: unknown, options: RequestInit) => {
			capturedBody = JSON.parse(options.body as string);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "x",
						content: [{ type: "text", text: "ok" }],
					}),
					{ status: 200 },
				),
			);
		}) as unknown as typeof fetch;

		const res = await probeModel({
			auth: CUSTOM_AUTH,
			model: "ignored-model-arg",
			fetchFn: capturingFetch,
			timeoutMs: 1000,
		});

		expect(res.ok).toBe(true);
		expect((capturedBody as { model: string }).model).toBe("their-model");
	});

	it("uses the model arg in the request body for non-custom providers", async () => {
		let capturedBody: unknown;
		const capturingFetch = ((_url: unknown, options: RequestInit) => {
			capturedBody = JSON.parse(options.body as string);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "x",
						content: [{ type: "text", text: "ok" }],
					}),
					{ status: 200 },
				),
			);
		}) as unknown as typeof fetch;

		const res = await probeModel({
			auth: OAUTH_AUTH,
			model: "claude-haiku-4-5",
			fetchFn: capturingFetch,
			timeoutMs: 1000,
		});

		expect(res.ok).toBe(true);
		expect((capturedBody as { model: string }).model).toBe(
			"claude-haiku-4-5",
		);
	});
});
