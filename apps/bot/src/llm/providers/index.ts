/**
 * Provider-adapter dispatch (multi-provider-model-switching, Task 3.2).
 *
 * `adapterFor(auth)` is the single seam entry point: it maps a resolved
 * `LlmAuth` to the concrete `ProviderAdapter` that owns that provider family's
 * wire shape. The three legacy auth types (`anthropic_api_key`, `claude_oauth`,
 * `custom`) dispatch to the shared `AnthropicAdapter`; the OpenAI-compatible
 * providers (`openai`, `openrouter`) dispatch to an `OpenAiCompatibleAdapter`
 * constructed with the matching base URL.
 *
 * The two `OpenAiCompatibleAdapter` instances are created once at module load
 * (they are stateless aside from their base URL) and reused across calls.
 */

import type { LlmAuth } from "../credentials.js";
import { AnthropicAdapter } from "./anthropic.js";
import {
	OPENAI_BASE_URL,
	OPENROUTER_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";
import type { ProviderAdapter } from "./types.js";

/** OpenAI provider adapter (api.openai.com), reused across calls. */
const openAiAdapter = new OpenAiCompatibleAdapter(OPENAI_BASE_URL);
/** OpenRouter provider adapter (openrouter.ai/api), reused across calls. */
const openRouterAdapter = new OpenAiCompatibleAdapter(OPENROUTER_BASE_URL);

/**
 * Return the `ProviderAdapter` for a resolved credential, keyed on `auth.type`.
 *
 *  - `anthropic_api_key` / `claude_oauth` / `custom` → `AnthropicAdapter`
 *  - `openai` → `OpenAiCompatibleAdapter(OPENAI_BASE_URL)`
 *  - `openrouter` → `OpenAiCompatibleAdapter(OPENROUTER_BASE_URL)`
 */
export function adapterFor(auth: LlmAuth): ProviderAdapter {
	switch (auth.type) {
		case "anthropic_api_key":
		case "claude_oauth":
		case "custom":
			return AnthropicAdapter;
		case "openai":
			return openAiAdapter;
		case "openrouter":
			return openRouterAdapter;
		default: {
			// Exhaustiveness guard: a new LlmAuth variant must add a branch here.
			const _exhaustive: never = auth;
			throw new Error(
				`adapterFor: no adapter for auth type "${(_exhaustive as LlmAuth).type}"`,
			);
		}
	}
}
