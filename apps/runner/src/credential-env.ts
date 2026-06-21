import type { TaskSpec } from "@anywarecode/shared";

/**
 * The credential env vars the Claude Agent SDK reads. Every run clears all of
 * these and then sets exactly one coherent set (see index.ts) — setting more
 * than one credential at a time makes the SDK reject the request.
 */
export type CredentialEnv = {
	ANTHROPIC_API_KEY?: string;
	CLAUDE_CODE_OAUTH_TOKEN?: string;
	ANTHROPIC_AUTH_TOKEN?: string;
	ANTHROPIC_BASE_URL?: string;
	ANTHROPIC_MODEL?: string;
};

/**
 * Pure mapping from a legacy (non-translator) auth type to the credential env
 * vars the SDK reads. This is a verbatim extraction of the historical inline
 * switch arms so the wiring stays byte-for-byte identical to today:
 *
 *   anthropic_api_key → ANTHROPIC_API_KEY = token
 *   claude_oauth      → CLAUDE_CODE_OAUTH_TOKEN = token
 *   custom            → ANTHROPIC_BASE_URL = baseUrl,
 *                       ANTHROPIC_AUTH_TOKEN = token,
 *                       ANTHROPIC_MODEL = model
 *
 * `openai`/`openrouter` are intentionally NOT handled here: they require
 * starting the localhost translation sidecar (async, side-effecting), so their
 * env wiring lives inline in index.ts. For those types this returns `{}`.
 */
export function credentialEnv(llmAuth: TaskSpec["llmAuth"]): CredentialEnv {
	switch (llmAuth.type) {
		case "anthropic_api_key":
			return { ANTHROPIC_API_KEY: llmAuth.token };
		case "claude_oauth":
			return { CLAUDE_CODE_OAUTH_TOKEN: llmAuth.token };
		case "custom":
			return {
				ANTHROPIC_BASE_URL: llmAuth.baseUrl,
				ANTHROPIC_AUTH_TOKEN: llmAuth.token,
				ANTHROPIC_MODEL: llmAuth.model,
			};
		default:
			return {};
	}
}
