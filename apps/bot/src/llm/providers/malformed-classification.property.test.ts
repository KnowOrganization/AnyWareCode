import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intentDecisionSchema } from "../chat.js";
import {
	OPENAI_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";

/**
 * Property 14: Malformed classification response falls back to a reply.
 *
 * For any OpenAI-compatible response that is empty, structurally unparseable,
 * or missing the required decision attribute, decision extraction yields
 * `null`. The design (§2, "Classification fallback (Req 6.5)") specifies that a
 * `null` decision on a 200 deterministically maps to
 * `{ action: "reply", ... }` so downstream routing is a conversational reply
 * rather than a task launch.
 *
 * NOTE ON SCOPE: the chat-path wiring that maps a `null` decision to a reply
 * (task 5.1 — routing `classifyIntent` onto the adapter seam and mapping
 * `null` → `{ action: "reply" }`) has not landed yet; `chat.ts` still classifies
 * through the Anthropic shape directly. This property therefore asserts the
 * adapter contract that the fallback depends on: `extractDecision` returns
 * `null` for every malformed OpenAI body. Once task 5.1 lands, the classify
 * path should additionally be asserted to resolve to a reply (not a task
 * launch) for these same bodies.
 *
 * Validates: Requirements 6.5
 */

/** OpenAI-compatible adapter under test (base URL is irrelevant to extraction). */
const adapter = new OpenAiCompatibleAdapter(OPENAI_BASE_URL);

/** Wrap a `tool_calls[0].function.arguments` value into a full response body. */
function bodyWithArguments(args: unknown): unknown {
	return {
		choices: [
			{
				message: {
					tool_calls: [{ function: { name: "decide", arguments: args } }],
				},
			},
		],
	};
}

/** Empty / null / undefined bodies — no `choices` to read at all. */
const emptyBodyArb: fc.Arbitrary<unknown> = fc.constantFrom(
	{},
	null,
	undefined,
	[],
	"",
);

/**
 * Bodies whose `choices` path is absent or malformed before reaching a
 * `message`: missing `choices`, non-array `choices`, empty `choices`, or a
 * first choice without a usable `message`.
 */
const missingChoicesArb: fc.Arbitrary<unknown> = fc.oneof(
	fc.record({ id: fc.string(), object: fc.string() }),
	fc.record({ choices: fc.constantFrom(null, undefined, "x", 0, {}) }),
	fc.constant({ choices: [] }),
	fc.constant({ choices: [null] }),
	fc.constant({ choices: [{}] }),
	fc.constant({ choices: [{ message: null }] }),
);

/**
 * `message` present but no usable `tool_calls`: missing, non-array, empty, or a
 * first tool call without a `function`/`arguments`. (A plain `content` reply
 * with no tool call is the canonical "model chose to chat" miss.)
 */
const missingToolCallsArb: fc.Arbitrary<unknown> = fc.oneof(
	fc.constant({ choices: [{ message: {} }] }),
	fc.constant({ choices: [{ message: { content: "just chatting" } }] }),
	fc.constant({ choices: [{ message: { tool_calls: null } }] }),
	fc.constant({ choices: [{ message: { tool_calls: [] } }] }),
	fc.constant({ choices: [{ message: { tool_calls: [null] } }] }),
	fc.constant({ choices: [{ message: { tool_calls: [{}] } }] }),
	fc.constant({ choices: [{ message: { tool_calls: [{ function: {} }] } }] }),
);

/**
 * `arguments` present but not a JSON string: a non-string value (number,
 * object, null, ...). `extractDecision` requires a string and returns `null`
 * for anything else.
 */
const nonStringArgumentsArb: fc.Arbitrary<unknown> = fc
	.oneof(
		fc.integer(),
		fc.boolean(),
		fc.constant(null),
		fc.object(),
		fc.array(fc.string()),
	)
	.map((args) => bodyWithArguments(args));

/**
 * `arguments` is a string that is NOT valid JSON, so the guarded `JSON.parse`
 * throws and extraction returns `null`. Filtered to guarantee unparseability.
 */
const unparseableArgumentsArb: fc.Arbitrary<unknown> = fc
	.string({ maxLength: 40 })
	.filter((s) => {
		try {
			JSON.parse(s);
			return false;
		} catch {
			return true;
		}
	})
	.map((s) => bodyWithArguments(s));

/**
 * `arguments` is valid JSON that parses to an object which FAILS
 * `intentDecisionSchema` — missing `action`, a non-enum `action`, or an action
 * missing its required companion field (`reply` without `reply_text`, a task
 * action without `task_prompt`). Filtered to guarantee schema rejection.
 */
const schemaFailingArgumentsArb: fc.Arbitrary<unknown> = fc
	.oneof(
		fc.constant({}),
		fc.record({ action: fc.string() }),
		fc.constant({ action: "bogus" }),
		fc.constant({ action: "reply" }),
		fc.constant({ action: "reply", reply_text: "   " }),
		fc.constant({ action: "code" }),
		fc.constant({ action: "ask", task_prompt: "" }),
		fc.constant({ action: "propose_code", task_summary: "x" }),
		fc.record(
			{
				action: fc.constantFrom("reply", "ask", "code", "propose_code"),
				reply_text: fc.option(fc.string(), { nil: undefined }),
				task_prompt: fc.option(fc.string(), { nil: undefined }),
			},
			{ requiredKeys: [] },
		),
	)
	.filter((obj) => !intentDecisionSchema.safeParse(obj).success)
	.map((obj) => bodyWithArguments(JSON.stringify(obj)));

/** All malformed-body categories Property 14 must reject. */
const malformedBodyArb: fc.Arbitrary<unknown> = fc.oneof(
	emptyBodyArb,
	missingChoicesArb,
	missingToolCallsArb,
	nonStringArgumentsArb,
	unparseableArgumentsArb,
	schemaFailingArgumentsArb,
);

describe("Property 14: Malformed classification response falls back to a reply", () => {
	// Feature: multi-provider-model-switching, Property 14: Malformed classification
	// response falls back to a reply — for any OpenAI-compatible response that is
	// empty, unparseable, or missing the required decision attribute, decision
	// extraction yields null and the classify path resolves to a conversational
	// reply rather than launching a task.
	// Validates: Requirements 6.5
	it("extractDecision returns null for every malformed OpenAI-compatible body", () => {
		fc.assert(
			fc.property(malformedBodyArb, (body) => {
				const decision = adapter.extractDecision(body);

				// The adapter contract the reply-fallback depends on: no decision is
				// recovered, so the classify path cannot launch a task and (per the
				// design's null → { action: "reply" } mapping, landing in task 5.1)
				// must fall back to a conversational reply.
				expect(decision).toBeNull();
			}),
			{ numRuns: 100 },
		);
	});
});
