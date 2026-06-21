import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import { schema, type Db } from "@anywarecode/db";
import { log } from "../observability.js";
import { effectiveModel } from "./providers/defaults.js";

function deriveKey(secret: string): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(secret, "utf8"),
			// HKDF salt is frozen at the original value on purpose — changing it would
			// make every stored credential blob undecryptable. NOT a rename target.
			"anywherecode",
			"credential-encryption-v1",
			32,
		),
	);
}

export function encryptCredential(
	secret: string,
	guildId: string,
	plaintext: string,
): string {
	const key = deriveKey(secret);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(guildId, "utf8"));
	const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `v1.${iv.toString("base64url")}.${ct.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptCredential(
	secret: string,
	guildId: string,
	blob: string,
): string | null {
	try {
		const parts = blob.split(".");
		if (parts[0] !== "v1" || parts.length !== 4) return null;
		const [, ivB64, ctB64, tagB64] = parts as [
			string,
			string,
			string,
			string,
		];
		const key = deriveKey(secret);
		const iv = Buffer.from(ivB64, "base64url");
		const ct = Buffer.from(ctB64, "base64url");
		const tag = Buffer.from(tagB64, "base64url");
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAAD(Buffer.from(guildId, "utf8"));
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
			"utf8",
		);
	} catch {
		return null;
	}
}

export type LlmAuth =
	| { type: "anthropic_api_key"; token: string }
	| { type: "claude_oauth"; token: string }
	| { type: "custom"; token: string; baseUrl: string; model: string }
	| { type: "openai"; token: string; model: string }
	| { type: "openrouter"; token: string; model: string };

export type ResolvedLlmAuth =
	| { auth: LlmAuth; source: "guild" }
	| { auth: null; reason: string };

export async function resolveLlmAuth(
	db: Db,
	config: Config,
	guildId: string,
): Promise<ResolvedLlmAuth> {
	const guild = await db.query.guilds.findFirst({
		where: eq(schema.guilds.id, guildId),
	});

	if (guild?.llmProviderType && guild.llmCredentialEnc) {
		const token = decryptCredential(
			config.CREDENTIAL_SECRET,
			guildId,
			guild.llmCredentialEnc,
		);
		if (!token) {
			// Operator-visible signal for a CREDENTIAL_SECRET rotation / mismatch
			// (message only — never the blob).
			log.warn({ guildId }, "guild LLM credential failed to decrypt");
			return {
				auth: null,
				reason:
					"Stored credential unreadable — admin must run `/connect llm` again (key may have rotated).",
			};
		}
		if (guild.llmProviderType === "custom") {
			if (!guild.llmBaseUrl || !guild.llmModel) {
				return {
					auth: null,
					reason:
						"Custom provider config incomplete — admin must run `/connect llm` again.",
				};
			}
			return {
				auth: {
					type: "custom",
					token,
					baseUrl: guild.llmBaseUrl,
					model: guild.llmModel,
				},
				source: "guild",
			};
		}
		if (
			guild.llmProviderType === "openai" ||
			guild.llmProviderType === "openrouter"
		) {
			// OpenAI-compatible providers carry the guild's effective model so the
			// Task_Path/Runner run on the Selected_Model when set, otherwise the
			// Provider_Type's Default_Model (Req 7.1, design "Effective model").
			return {
				auth: {
					type: guild.llmProviderType,
					token,
					model: effectiveModel(
						guild.llmProviderType,
						guild.llmModel,
						config,
					),
				},
				source: "guild",
			};
		}
		if (
			guild.llmProviderType === "claude_oauth" ||
			guild.llmProviderType === "anthropic_api_key"
		) {
			return {
				auth: { type: guild.llmProviderType, token },
				source: "guild",
			};
		}
	}

	// BYO-LLM only: there is no platform key. Every server connects its own.
	return {
		auth: null,
		reason: "No LLM connected. Admin: run `/connect llm`.",
	};
}

/**
 * Probe model used for the Anthropic legacy auth types (`anthropic_api_key`,
 * `claude_oauth`) when the credential carries no model of its own. Frozen at the
 * value the pre-adapter `validateLlmAuth` used so the probe stays byte-identical
 * to the captured golden fixture (`anthropic.golden.test.ts`). `custom` and the
 * OpenAI-compatible providers carry their own model and never fall back to this.
 */
const PROBE_FALLBACK_MODEL = "claude-haiku-4-5-20251001";

/** Hard ceiling on the credential probe (Req 3.2): 10 seconds. */
const VALIDATION_TIMEOUT_MS = 10_000;

/** Minimal shape of the response `validateLlmAuth` reads from a probe. */
interface ProbeResponse {
	status: number;
	text(): Promise<string>;
}

/**
 * Injectable `fetch` used by the probe. The default delegates to the global
 * `fetch`; tests pass a fake that resolves a chosen status or rejects on
 * abort to exercise the timeout path (Req 3.2/3.5) without touching the network.
 */
export type ProbeFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body: string;
		signal: AbortSignal;
	},
) => Promise<ProbeResponse>;

/**
 * Injectable timer seam for the 10s validation deadline. Defaults to the global
 * `setTimeout`/`clearTimeout`; tests inject fakes (or use fake timers) to drive
 * the abort deterministically. The handle is opaque so callers need not depend
 * on the platform timer type.
 */
export interface ValidateLlmAuthDeps {
	fetchFn?: ProbeFetch;
	setTimeoutFn?: (handler: () => void, timeoutMs: number) => unknown;
	clearTimeoutFn?: (handle: unknown) => void;
	timeoutMs?: number;
}

const defaultProbeFetch: ProbeFetch = (url, init) => fetch(url, init);

/**
 * Issue a single live credential/model probe through the provider adapter and
 * classify the outcome (Req 3.1–3.6).
 *
 *  - The request shape comes entirely from the adapter: `adapter.endpoint(auth)`
 *    supplies the URL + auth headers and `adapter.buildProbeBody(model)` the
 *    smallest valid body, so Anthropic probes hit `/v1/messages` and
 *    OpenAI-compatible probes hit `/v1/chat/completions` (Req 3.1).
 *  - The effective probe model is resolved via the adapter: `custom`,
 *    `openai`, and `openrouter` carry their own model; the Anthropic legacy
 *    types fall back to the frozen `PROBE_FALLBACK_MODEL`.
 *  - The whole call runs under a 10s `AbortController` deadline (Req 3.2).
 *  - `401`/`403` → reject "Authentication failed…" (Req 3.3); `200` or `400`
 *    (param error that nonetheless authenticated) → ok (Req 3.4); abort/timeout
 *    or any transport error → reject "Connection failed…" (Req 3.5).
 *  - Reason strings never include the token or any auth header value: they are
 *    fixed copy that never interpolates the credential or response body (Req 3.6).
 *
 * `fetchFn` and the timer functions are injectable for testing; production
 * callers invoke `validateLlmAuth(auth)` with defaults.
 */
export async function validateLlmAuth(
	auth: LlmAuth,
	deps: ValidateLlmAuthDeps = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const fetchFn = deps.fetchFn ?? defaultProbeFetch;
	const setTimeoutFn =
		deps.setTimeoutFn ??
		((handler: () => void, ms: number) => setTimeout(handler, ms));
	const clearTimeoutFn =
		deps.clearTimeoutFn ??
		((handle: unknown) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>));
	const timeoutMs = deps.timeoutMs ?? VALIDATION_TIMEOUT_MS;

	// Lazy import: `providers/index` eagerly constructs the adapter singletons at
	// module load, and importing it at the top of this file would close an
	// initialization cycle (credentials → providers/index → openai-compatible →
	// chat → credentials). Resolving it here, at call time, keeps the seam
	// (`adapterFor`) without the load-order hazard.
	const { adapterFor } = await import("./providers/index.js");
	const adapter = adapterFor(auth);
	const { url, headers } = adapter.endpoint(auth);
	const model = adapter.effectiveModel(auth, PROBE_FALLBACK_MODEL);
	const body = JSON.stringify(adapter.buildProbeBody(model));

	const controller = new AbortController();
	const timer = setTimeoutFn(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchFn(url, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body,
			signal: controller.signal,
		});
		if (res.status === 401 || res.status === 403) {
			// Req 3.3 — auth failure. Fixed copy: never echoes the credential.
			return {
				ok: false,
				reason: "Authentication failed (401/403). Check your credential.",
			};
		}
		// Req 3.4 — 200 = full success; 400 = params error but auth passed.
		if (res.status === 200 || res.status === 400) return { ok: true };
		// Any other status is not a clear authentication pass; treat it as a
		// connection-level failure. The reason names only the status code — never
		// the token, auth header, or response body (Req 3.6).
		return {
			ok: false,
			reason: `Connection failed: unexpected status ${res.status}.`,
		};
	} catch {
		// Req 3.5 — abort/timeout or any transport error. The error is swallowed
		// so no credential material can leak into the reason string (Req 3.6).
		return {
			ok: false,
			reason: "Connection failed. Could not reach the provider.",
		};
	} finally {
		clearTimeoutFn(timer);
	}
}

/** Messages-API endpoint + auth headers for each provider type. Single source
 * for the three auth shapes; used by credential probes and the chat classifier. */
export function buildAnthropicHeaders(auth: LlmAuth): {
	url: string;
	headers: Record<string, string>;
} {
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
		case "openai":
		case "openrouter":
			// OpenAI-compatible providers do not speak the Anthropic Messages
			// envelope; their endpoint + headers come from OpenAiCompatibleAdapter
			// (providers/openai-compatible.ts). Reaching here is a routing bug.
			throw new Error(
				`buildAnthropicHeaders does not handle OpenAI-compatible provider "${auth.type}"; use the provider adapter seam instead.`,
			);
	}
}

const AUTH_ERROR_RE =
	/\b(401|403|authentication_error|invalid.*(key|token)|unauthorized)\b/i;

export function isAuthError(message: string): boolean {
	return AUTH_ERROR_RE.test(message);
}
