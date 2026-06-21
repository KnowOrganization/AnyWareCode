/**
 * Provider-adapter seam types (multi-provider-model-switching).
 *
 * This module defines the `ProviderAdapter` interface — the single seam through
 * which every direct LLM call builds its request and parses its response in a
 * provider-specific way, while the shared status→`FailureMode` classifier,
 * retry, and message-builder layers stay common. It is a types-only module:
 * no network, filesystem, or other I/O happens here.
 *
 * The concrete adapters (`AnthropicAdapter`, `OpenAiCompatibleAdapter`) and the
 * `adapterFor` dispatcher implement this interface in sibling modules.
 */

import type { ChatContext, IntentDecision } from "../chat.js";
import type { LlmAuth } from "../credentials.js";
import type { HeaderGet, RateLimitInfo } from "../failures.js";

// Re-export the shared types the seam consumes so adapter implementations and
// callers can import them from one place.
export type { ChatContext, IntentDecision } from "../chat.js";
export type { LlmAuth } from "../credentials.js";
export type { HeaderGet, RateLimitInfo } from "../failures.js";

/**
 * A provider adapter owns everything wire-shape-specific for one family of
 * providers: the endpoint and auth headers, request-body building (classify /
 * reply / probe), and response extraction (decision / reply text / soft-error
 * detection / rate-limit header parsing / model-availability classification).
 *
 * Anthropic (`anthropic_api_key`, `claude_oauth`, `custom`) and the
 * OpenAI-compatible providers (`openai`, `openrouter`) each implement this
 * interface; the shared pipeline depends only on the interface, never on a
 * specific wire shape.
 */
export interface ProviderAdapter {
	/** Endpoint + auth headers for this credential (no content-type). */
	endpoint(auth: LlmAuth): { url: string; headers: Record<string, string> };

	/** Effective model for the call: Selected_Model when set, else Default_Model. */
	effectiveModel(auth: LlmAuth, fallbackModel: string): string;

	/** Build the structured-classification request body for the wire shape. */
	buildClassifyBody(model: string, ctx: ChatContext): unknown;
	/** Build the free-form reply request body. */
	buildReplyBody(model: string, ctx: ChatContext): unknown;
	/** Build the smallest valid credential/model probe body (Req 3.1). */
	buildProbeBody(model: string): unknown;

	/** Extract a structured intent decision, or null when none is present (Req 6.4/6.5). */
	extractDecision(body: unknown): IntentDecision | null;
	/** Extract the joined assistant reply text (Req 6.2). */
	extractReplyText(body: unknown): string;

	/** True when a 200 body actually encodes a provider error (Anthropic soft error). */
	isProviderErrorBody(body: unknown): boolean;
	/** Parse provider-specific rate-limit headers into the shared RateLimitInfo. */
	parseRateLimitInfo(args: {
		headers: HeaderGet;
		receivedAtMs: number;
	}): RateLimitInfo;

	/**
	 * Classify a probe/validation outcome as a model-unavailable signal: a
	 * `400`/`404` whose body indicates an unknown or unavailable model maps to
	 * `true` so the Model_Selector can respond "model is unavailable" (Req 10.2),
	 * while auth/timeout/network failures map to `false` ("could not be
	 * validated", Req 10.3).
	 */
	isModelUnavailable(status: number, body: unknown): boolean;
}

/**
 * Dispatch to the correct adapter for a credential, keyed on `auth.type`.
 * Implemented in `providers/index.ts`; declared here so the seam's public
 * surface is described in one place.
 */
export type AdapterFor = (auth: LlmAuth) => ProviderAdapter;
