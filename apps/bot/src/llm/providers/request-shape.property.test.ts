import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ChatContext } from "../chat.js";
import { AnthropicAdapter } from "./anthropic.js";
import {
	OPENAI_BASE_URL,
	OPENROUTER_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";

/**
 * Property 11: Each adapter builds its provider's request shape carrying the
 * effective model.
 *
 * For any chat context and effective model, the OpenAI-compatible adapter
 * produces a Chat Completions request body (system-as-first-message, forced
 * `decide` function tool for classification) and the Anthropic adapter produces
 * a Messages request body (top-level `system`, `decide` tool), each carrying the
 * effective model.
 */

const openai = new OpenAiCompatibleAdapter(OPENAI_BASE_URL);
const openrouter = new OpenAiCompatibleAdapter(OPENROUTER_BASE_URL);

/** Arbitrary single conversation-history entry. */
const historyMessageArb = fc.record({
	author: fc.string({ minLength: 1, maxLength: 32 }),
	isBot: fc.boolean(),
	timestamp: fc
		.date({
			min: new Date("2020-01-01T00:00:00Z"),
			max: new Date("2030-01-01T00:00:00Z"),
		})
		.map((d) => d.toISOString()),
	text: fc.string({ maxLength: 400 }),
});

/** Arbitrary ChatContext spanning the fields renderContext consumes. */
const chatContextArb: fc.Arbitrary<ChatContext> = fc.record(
	{
		history: fc.array(historyMessageArb, { maxLength: 6 }),
		mention: fc.record({
			author: fc.string({ minLength: 1, maxLength: 32 }),
			text: fc.string({ maxLength: 500 }),
		}),
		channelName: fc.string({ minLength: 1, maxLength: 32 }),
		repoFullName: fc.option(fc.string({ minLength: 1, maxLength: 64 }), {
			nil: null,
		}),
		finishedTask: fc.option(
			fc.record({
				prompt: fc.string({ maxLength: 200 }),
				prNumber: fc.option(fc.integer({ min: 1, max: 99999 }), {
					nil: null,
				}),
				status: fc.string({ minLength: 1, maxLength: 16 }),
			}),
			{ nil: undefined },
		),
	},
	{ requiredKeys: ["history", "mention", "channelName", "repoFullName"] },
);

/** Arbitrary effective model identifier (non-empty). */
const modelArb = fc.string({ minLength: 1, maxLength: 80 });

describe("Property 11: Each adapter builds its provider's request shape carrying the effective model", () => {
	// Feature: multi-provider-model-switching, Property 11: Each adapter builds its
	// provider's request shape carrying the effective model — the OpenAI-compatible
	// adapter produces a Chat Completions body (system-as-first-message, forced
	// `decide` function tool) and the Anthropic adapter produces a Messages body
	// (top-level `system`, `decide` tool), each carrying the effective model.
	// Validates: Requirements 6.1, 6.3

	it("OpenAI-compatible adapters build a Chat Completions classify body carrying the model", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(openai, openrouter),
				modelArb,
				chatContextArb,
				(adapter, model, ctx) => {
					const body = adapter.buildClassifyBody(model, ctx) as {
						model: string;
						messages: Array<{ role: string; content: unknown }>;
						tools: Array<{
							type: string;
							function: { name: string };
						}>;
						tool_choice: { type: string; function: { name: string } };
					};

					// carries the effective model
					expect(body.model).toBe(model);
					// system prompt is the FIRST message (OpenAI shape), user follows
					expect(body.messages[0]?.role).toBe("system");
					expect(body.messages[1]?.role).toBe("user");
					// forced `decide` function tool
					expect(body.tools[0]?.type).toBe("function");
					expect(body.tools[0]?.function.name).toBe("decide");
					expect(body.tool_choice).toEqual({
						type: "function",
						function: { name: "decide" },
					});
				},
			),
			{ numRuns: 100 },
		);
	});

	it("Anthropic adapter builds a Messages classify body carrying the model", () => {
		fc.assert(
			fc.property(modelArb, chatContextArb, (model, ctx) => {
				const body = AnthropicAdapter.buildClassifyBody(model, ctx) as {
					model: string;
					system: unknown;
					tools: Array<{ name: string }>;
					tool_choice: { type: string; name: string };
					messages: Array<{ role: string }>;
				};

				// carries the effective model
				expect(body.model).toBe(model);
				// top-level `system` field (Messages shape), not a system message
				expect(typeof body.system).toBe("string");
				expect((body.system as string).length).toBeGreaterThan(0);
				expect(body.messages[0]?.role).toBe("user");
				// `decide` tool surfaced as a Messages tool, forced via tool_choice
				expect(body.tools[0]?.name).toBe("decide");
				expect(body.tool_choice).toEqual({ type: "tool", name: "decide" });
			}),
			{ numRuns: 100 },
		);
	});
});
