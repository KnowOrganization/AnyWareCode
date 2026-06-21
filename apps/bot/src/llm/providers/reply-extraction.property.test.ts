import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import {
	OPENAI_BASE_URL,
	OPENROUTER_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";

/**
 * Property 12: Reply extraction reads the provider's response shape.
 *
 * For any successful provider response, the adapter extracts the assistant
 * reply from that provider's shape — `choices[0].message.content` for
 * OpenAI-compatible providers, joined `text` blocks for Anthropic. Both
 * adapters trim the extracted text.
 */

const openai = new OpenAiCompatibleAdapter(OPENAI_BASE_URL);
const openrouter = new OpenAiCompatibleAdapter(OPENROUTER_BASE_URL);

/**
 * Arbitrary reply strings spanning the input space the extractors must handle:
 * arbitrary unicode content plus strings deliberately wrapped in surrounding
 * whitespace so the trimming behavior is exercised.
 */
const replyArb: fc.Arbitrary<string> = fc.oneof(
	fc.string({ maxLength: 200 }),
	fc
		.tuple(
			fc
				.array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 6 })
				.map((p) => p.join("")),
			fc.string({ maxLength: 100 }),
			fc
				.array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 6 })
				.map((p) => p.join("")),
		)
		.map(([lead, core, trail]) => `${lead}${core}${trail}`),
);

describe("Property 12: Reply extraction reads the provider's response shape", () => {
	// Feature: multi-provider-model-switching, Property 12: Reply extraction reads
	// the provider's response shape — for any successful provider response, the
	// adapter extracts the assistant reply from that provider's shape:
	// choices[0].message.content (OpenAI-compatible) and joined text blocks
	// (Anthropic). Both trim the result.
	// Validates: Requirements 6.2

	it("OpenAI-compatible extracts choices[0].message.content (trimmed)", () => {
		fc.assert(
			fc.property(replyArb, (reply) => {
				const body = { choices: [{ message: { content: reply } }] };
				const expected = reply.trim();
				expect(openai.extractReplyText(body)).toBe(expected);
				expect(openrouter.extractReplyText(body)).toBe(expected);
			}),
			{ numRuns: 100 },
		);
	});

	it("Anthropic joins all text blocks (trimmed)", () => {
		fc.assert(
			fc.property(
				fc.array(replyArb, { minLength: 1, maxLength: 5 }),
				(texts) => {
					const body = {
						content: texts.map((text) => ({ type: "text", text })),
					};
					const expected = texts.join("").trim();
					expect(AnthropicAdapter.extractReplyText(body)).toBe(expected);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("Anthropic joins only text blocks, ignoring non-text content blocks", () => {
		fc.assert(
			fc.property(
				fc.array(replyArb, { minLength: 1, maxLength: 4 }),
				replyArb,
				(texts, toolText) => {
					// Interleave a non-text block (e.g. tool_use) that must be skipped.
					const body = {
						content: [
							{ type: "tool_use", name: "decide", input: {} },
							...texts.map((text) => ({ type: "text", text })),
							{ type: "tool_use", name: "other", text: toolText },
						],
					};
					const expected = texts.join("").trim();
					expect(AnthropicAdapter.extractReplyText(body)).toBe(expected);
				},
			),
			{ numRuns: 100 },
		);
	});
});
