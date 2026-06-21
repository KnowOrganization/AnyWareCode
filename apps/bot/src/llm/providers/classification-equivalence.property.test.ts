import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intentDecisionSchema, type IntentDecision } from "../chat.js";
import { AnthropicAdapter } from "./anthropic.js";
import {
	OPENAI_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";

/**
 * Property 13: Classification routing equivalence across providers.
 *
 * The two wire shapes carry a structured `decide` decision differently —
 * Anthropic surfaces it as a `tool_use` content block (`input` is the decision
 * object), OpenAI-compatible providers surface it as a `tool_calls` function
 * call (`arguments` is a JSON string). This test encodes the *same* valid
 * `IntentDecision` into both shapes, extracts it back through each adapter, and
 * asserts the recovered decisions are identical (and equal to the original), so
 * downstream task routing is provider-independent.
 */

/** OpenAI-compatible adapter under test (base URL is irrelevant to extraction). */
const openAiAdapter = new OpenAiCompatibleAdapter(OPENAI_BASE_URL);

/** A string that is non-empty after trimming (satisfies the schema refinements). */
const nonEmptyTrimmed = fc
	.string({ minLength: 1, maxLength: 80 })
	.filter((s) => s.trim().length > 0);

/** Any string, including empty — valid for the unconstrained optional fields. */
const anyStr = fc.string({ maxLength: 80 });

/**
 * A `reply` decision: `reply_text` is required and non-empty (per the schema's
 * refinement); `task_prompt`/`task_summary` are optionally present.
 */
const replyArb: fc.Arbitrary<IntentDecision> = fc.record(
	{
		action: fc.constant("reply" as const),
		reply_text: nonEmptyTrimmed,
		task_prompt: anyStr,
		task_summary: anyStr,
	},
	{ requiredKeys: ["action", "reply_text"] },
) as fc.Arbitrary<IntentDecision>;

/**
 * A task decision (`ask`/`code`/`propose_code`): `task_prompt` is required and
 * non-empty; `reply_text`/`task_summary` are optionally present.
 */
const taskArb: fc.Arbitrary<IntentDecision> = fc.record(
	{
		action: fc.constantFrom(
			"ask" as const,
			"code" as const,
			"propose_code" as const,
		),
		task_prompt: nonEmptyTrimmed,
		reply_text: anyStr,
		task_summary: anyStr,
	},
	{ requiredKeys: ["action", "task_prompt"] },
) as fc.Arbitrary<IntentDecision>;

/** Arbitrary VALID `IntentDecision` respecting both schema refinements. */
const decisionArb: fc.Arbitrary<IntentDecision> = fc.oneof(replyArb, taskArb);

/** Encode a decision into an Anthropic Messages `tool_use` response body. */
function anthropicBody(decision: IntentDecision): unknown {
	return {
		content: [{ type: "tool_use", name: "decide", input: decision }],
	};
}

/** Encode a decision into an OpenAI Chat Completions `tool_calls` response body. */
function openAiBody(decision: IntentDecision): unknown {
	return {
		choices: [
			{
				message: {
					tool_calls: [
						{
							function: {
								name: "decide",
								arguments: JSON.stringify(decision),
							},
						},
					],
				},
			},
		],
	};
}

describe("Property 13: Classification routing equivalence across providers", () => {
	// Feature: multi-provider-model-switching, Property 13: Classification routing
	// equivalence across providers — for any valid intent decision, encoding it into
	// an Anthropic tool_use body and an OpenAI tool_calls body and extracting through
	// the respective adapter yields equal IntentDecision values, so downstream task
	// routing is identical regardless of provider.
	// Validates: Requirements 6.4
	it("extracts identical decisions from Anthropic and OpenAI-compatible bodies", () => {
		fc.assert(
			fc.property(decisionArb, (decision) => {
				// Sanity: the generated decision is genuinely valid under the schema.
				expect(intentDecisionSchema.safeParse(decision).success).toBe(true);

				const fromAnthropic = AnthropicAdapter.extractDecision(
					anthropicBody(decision),
				);
				const fromOpenAi = openAiAdapter.extractDecision(
					openAiBody(decision),
				);

				// Both adapters recover a decision (no fallback to null).
				expect(fromAnthropic).not.toBeNull();
				expect(fromOpenAi).not.toBeNull();

				// The two recovered decisions are equal to each other and to the
				// original, guaranteeing provider-independent downstream routing.
				expect(fromOpenAi).toEqual(fromAnthropic);
				expect(fromAnthropic).toEqual(decision);
				expect(fromOpenAi).toEqual(decision);
			}),
			{ numRuns: 100 },
		);
	});
});
