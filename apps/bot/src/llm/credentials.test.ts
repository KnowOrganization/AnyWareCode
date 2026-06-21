import { describe, expect, it } from "vitest";
import {
	decryptCredential,
	encryptCredential,
	isAuthError,
	validateLlmAuth,
	type LlmAuth,
	type ProbeFetch,
} from "./credentials.js";

const SECRET = "a-very-secret-key-that-is-at-least-32-chars!!";
const GUILD = "123456789012345678";

describe("encrypt / decrypt", () => {
	it("round-trips plaintext", () => {
		const blob = encryptCredential(SECRET, GUILD, "sk-ant-api-token");
		expect(decryptCredential(SECRET, GUILD, blob)).toBe("sk-ant-api-token");
	});

	it("returns null for a tampered ciphertext byte", () => {
		const blob = encryptCredential(SECRET, GUILD, "token");
		const parts = blob.split(".");
		// Flip the FIRST char of the ciphertext part. The last base64url char of a
		// non-block-aligned payload carries unused low bits, so flipping it can
		// decode to identical bytes (flaky). The first char's 6 bits are all
		// significant, so this always alters a ciphertext byte → GCM tag mismatch.
		const ct = parts[2]!;
		parts[2] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
		expect(decryptCredential(SECRET, GUILD, parts.join("."))).toBeNull();
	});

	it("returns null when AAD (guildId) differs — prevents cross-guild blob copy", () => {
		const blob = encryptCredential(SECRET, GUILD, "token");
		expect(decryptCredential(SECRET, "different-guild", blob)).toBeNull();
	});

	it("returns null with a rotated CREDENTIAL_SECRET", () => {
		const blob = encryptCredential(SECRET, GUILD, "token");
		expect(
			decryptCredential(
				"different-secret-also-at-least-32-chars!",
				GUILD,
				blob,
			),
		).toBeNull();
	});

	it("returns null for malformed blobs", () => {
		expect(decryptCredential(SECRET, GUILD, "garbage")).toBeNull();
		expect(decryptCredential(SECRET, GUILD, "v1.only.two")).toBeNull();
		expect(decryptCredential(SECRET, GUILD, "v2.a.b.c")).toBeNull();
		expect(decryptCredential(SECRET, GUILD, "")).toBeNull();
	});
});

describe("isAuthError", () => {
	it("matches 401/403 strings", () => {
		expect(isAuthError("status 401 Unauthorized")).toBe(true);
		expect(isAuthError("403 Forbidden")).toBe(true);
	});

	it("matches authentication_error / invalid key patterns", () => {
		expect(isAuthError("authentication_error: invalid api key")).toBe(true);
		expect(isAuthError("Invalid token provided")).toBe(true);
		expect(isAuthError("invalid key detected")).toBe(true);
	});

	it("does not match unrelated messages", () => {
		expect(isAuthError("rate_limit_exceeded")).toBe(false);
		expect(isAuthError("network timeout")).toBe(false);
		expect(isAuthError("")).toBe(false);
	});
});

describe("validateLlmAuth — 10s validation timeout (Req 3.2, 3.5)", () => {
	const PROBE_TOKEN = "sk-ant-super-secret-token-value-do-not-leak";
	const auth: LlmAuth = { type: "anthropic_api_key", token: PROBE_TOKEN };

	/**
	 * A probe fetch that never resolves on its own. It rejects only when the
	 * injected AbortSignal fires (covering the case where the signal is already
	 * aborted before the fetch is invoked, plus the live `abort` event). This
	 * models a provider that hangs until the validation deadline cuts it off.
	 */
	const neverResolvingFetch: ProbeFetch = (_url, init) =>
		new Promise((_resolve, reject) => {
			const fail = () =>
				reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
			if (init.signal.aborted) {
				fail();
				return;
			}
			init.signal.addEventListener("abort", fail);
			// Otherwise never settles — only the abort path resolves this promise.
		});

	it("aborts at the deadline and returns a connection-failed rejection", async () => {
		// Inject a timer that fires the deadline handler immediately, standing in
		// for the 10s timeout elapsing — deterministic, no wall-clock wait.
		const result = await validateLlmAuth(auth, {
			fetchFn: neverResolvingFetch,
			setTimeoutFn: (handler) => {
				handler();
				return 1;
			},
			clearTimeoutFn: () => {},
		});

		expect(result.ok).toBe(false);
		if (result.ok === false) {
			expect(result.reason).toMatch(/connection failed/i);
			// Req 3.6 — the credential must never appear in the user-facing reason.
			expect(result.reason).not.toContain(PROBE_TOKEN);
		}
	});

	it("defaults the validation deadline to 10 seconds when not overridden", async () => {
		let capturedTimeoutMs: number | undefined;

		const result = await validateLlmAuth(auth, {
			fetchFn: neverResolvingFetch,
			setTimeoutFn: (handler, timeoutMs) => {
				capturedTimeoutMs = timeoutMs;
				handler();
				return 1;
			},
			clearTimeoutFn: () => {},
			// timeoutMs intentionally omitted to exercise the default.
		});

		expect(capturedTimeoutMs).toBe(10_000);
		expect(result.ok).toBe(false);
	});
});
