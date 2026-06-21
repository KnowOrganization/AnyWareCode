import { describe, expect, it, vi } from "vitest";
import {
	chatCompletionToMessages,
	messagesToChatCompletions,
	startTranslator,
	synthesizeSSE,
	type AnthropicMessagesRequest,
	type ChatCompletionsResponse,
} from "./translator.js";

describe("messagesToChatCompletions", () => {
	it("hoists the system prompt to the first message", () => {
		const out = messagesToChatCompletions({
			model: "gpt-4o-mini",
			max_tokens: 100,
			system: "you are helpful",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(out.messages[0]).toEqual({
			role: "system",
			content: "you are helpful",
		});
		expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
		expect(out.model).toBe("gpt-4o-mini");
		expect(out.max_tokens).toBe(100);
	});

	it("flattens an array-form system prompt", () => {
		const out = messagesToChatCompletions({
			model: "m",
			system: [
				{ type: "text", text: "line one" },
				{ type: "text", text: "line two" },
			],
			messages: [{ role: "user", content: "hi" }],
		});
		expect(out.messages[0]).toEqual({
			role: "system",
			content: "line one\nline two",
		});
	});

	it("maps assistant tool_use blocks to OpenAI tool_calls", () => {
		const out = messagesToChatCompletions({
			model: "m",
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "let me check" },
						{
							type: "tool_use",
							id: "tu_1",
							name: "Read",
							input: { file_path: "a.ts" },
						},
					],
				},
			],
		});
		const asst = out.messages[0];
		expect(asst?.role).toBe("assistant");
		expect(asst?.content).toBe("let me check");
		expect(asst?.tool_calls).toEqual([
			{
				id: "tu_1",
				type: "function",
				function: {
					name: "Read",
					arguments: JSON.stringify({ file_path: "a.ts" }),
				},
			},
		]);
	});

	it("maps user tool_result blocks to role:tool messages preceding text", () => {
		const out = messagesToChatCompletions({
			model: "m",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tu_1",
							content: "file contents",
						},
						{ type: "text", text: "now do the thing" },
					],
				},
			],
		});
		expect(out.messages[0]).toEqual({
			role: "tool",
			tool_call_id: "tu_1",
			content: "file contents",
		});
		expect(out.messages[1]).toEqual({
			role: "user",
			content: "now do the thing",
		});
	});

	it("flattens array-form tool_result content", () => {
		const out = messagesToChatCompletions({
			model: "m",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tu_2",
							content: [
								{ type: "text", text: "part a" },
								{ type: "text", text: "part b" },
							],
						},
					],
				},
			],
		});
		expect(out.messages[0]?.content).toBe("part a\npart b");
	});

	it("translates tools and forced tool_choice", () => {
		const out = messagesToChatCompletions({
			model: "m",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					name: "decide",
					description: "decide intent",
					input_schema: { type: "object" },
				},
			],
			tool_choice: { type: "tool", name: "decide" },
		});
		expect(out.tools).toEqual([
			{
				type: "function",
				function: {
					name: "decide",
					description: "decide intent",
					parameters: { type: "object" },
				},
			},
		]);
		expect(out.tool_choice).toEqual({
			type: "function",
			function: { name: "decide" },
		});
	});

	it("maps tool_choice any to required and auto to auto", () => {
		const any = messagesToChatCompletions({
			model: "m",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "t", input_schema: {} }],
			tool_choice: { type: "any" },
		});
		expect(any.tool_choice).toBe("required");
		const auto = messagesToChatCompletions({
			model: "m",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "t", input_schema: {} }],
			tool_choice: { type: "auto" },
		});
		expect(auto.tool_choice).toBe("auto");
	});
});

describe("chatCompletionToMessages", () => {
	it("extracts assistant text", () => {
		const resp: ChatCompletionsResponse = {
			id: "cmpl_1",
			model: "gpt-4o-mini",
			choices: [
				{
					message: { role: "assistant", content: "hello there" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 3 },
		};
		const out = chatCompletionToMessages(resp, "fallback");
		expect(out.content).toEqual([{ type: "text", text: "hello there" }]);
		expect(out.stop_reason).toBe("end_turn");
		expect(out.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
		expect(out.id).toBe("cmpl_1");
		expect(out.model).toBe("gpt-4o-mini");
	});

	it("maps tool_calls to tool_use blocks and sets stop_reason", () => {
		const resp: ChatCompletionsResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: {
									name: "decide",
									arguments: '{"action":"reply"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		};
		const out = chatCompletionToMessages(resp, "fallback");
		expect(out.content).toEqual([
			{
				type: "tool_use",
				id: "call_1",
				name: "decide",
				input: { action: "reply" },
			},
		]);
		expect(out.stop_reason).toBe("tool_use");
	});

	it("keeps non-JSON tool arguments as raw instead of dropping them", () => {
		const resp: ChatCompletionsResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "c",
								type: "function",
								function: { name: "t", arguments: "not json" },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		};
		const out = chatCompletionToMessages(resp, "fallback");
		expect(out.content[0]).toMatchObject({
			type: "tool_use",
			input: { _raw: "not json" },
		});
	});

	it("maps length finish_reason to max_tokens", () => {
		const out = chatCompletionToMessages(
			{ choices: [{ message: { content: "x" }, finish_reason: "length" }] },
			"fallback",
		);
		expect(out.stop_reason).toBe("max_tokens");
	});

	it("falls back to the request model and an empty text block when absent", () => {
		const out = chatCompletionToMessages({ choices: [] }, "fallback-model");
		expect(out.model).toBe("fallback-model");
		expect(out.content).toEqual([{ type: "text", text: "" }]);
	});
});

describe("synthesizeSSE", () => {
	it("emits a well-formed Messages event sequence for text", () => {
		const sse = synthesizeSSE({
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "m",
			content: [{ type: "text", text: "hi" }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 2 },
		});
		expect(sse).toContain("event: message_start");
		expect(sse).toContain("event: content_block_start");
		expect(sse).toContain('"text_delta"');
		expect(sse).toContain("event: content_block_stop");
		expect(sse).toContain("event: message_delta");
		expect(sse).toContain("event: message_stop");
		// Each event terminates with a blank line.
		expect(sse.endsWith("\n\n")).toBe(true);
	});

	it("emits input_json_delta for tool_use blocks", () => {
		const sse = synthesizeSSE({
			id: "msg_2",
			type: "message",
			role: "assistant",
			model: "m",
			content: [
				{
					type: "tool_use",
					id: "t1",
					name: "decide",
					input: { action: "reply" },
				},
			],
			stop_reason: "tool_use",
			stop_sequence: null,
			usage: { input_tokens: 0, output_tokens: 0 },
		});
		expect(sse).toContain('"input_json_delta"');
		expect(sse).toContain('"tool_use"');
		expect(sse).toContain('{\\"action\\":\\"reply\\"}');
	});
});

describe("startTranslator", () => {
	it("binds to 127.0.0.1 and forwards a translated non-streaming request", async () => {
		const fetchFn = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body)) as {
					messages: unknown[];
					model: string;
				};
				// Echo so we can assert translation happened.
				return new Response(
					JSON.stringify({
						id: "cmpl",
						model: body.model,
						choices: [
							{
								message: { role: "assistant", content: "pong" },
								finish_reason: "stop",
							},
						],
						usage: { prompt_tokens: 1, completion_tokens: 1 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);

		const handle = await startTranslator({
			upstreamBaseUrl: "https://api.openai.com",
			apiKey: "sk-test",
			fetchFn: fetchFn as unknown as typeof fetch,
		});
		try {
			expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

			const resp = await fetch(`${handle.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "gpt-4o-mini",
					max_tokens: 50,
					system: "sys",
					messages: [{ role: "user", content: "ping" }],
				} satisfies AnthropicMessagesRequest),
			});
			expect(resp.status).toBe(200);
			const json = (await resp.json()) as {
				content: Array<{ text: string }>;
				role: string;
			};
			expect(json.role).toBe("assistant");
			expect(json.content[0]?.text).toBe("pong");

			// The upstream request was the OpenAI chat-completions shape with auth.
			expect(fetchFn).toHaveBeenCalledTimes(1);
			const [url, init] = fetchFn.mock.calls[0]!;
			expect(url).toBe("https://api.openai.com/v1/chat/completions");
			expect((init?.headers as Record<string, string>).authorization).toBe(
				"Bearer sk-test",
			);
			const sent = JSON.parse(String(init?.body)) as {
				messages: Array<{ role: string }>;
			};
			expect(sent.messages[0]?.role).toBe("system");
		} finally {
			await handle.close();
		}
	});

	it("replays an SSE stream when the client requests streaming", async () => {
		const fetchFn = vi.fn(
			async (_url: string | URL | Request, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						choices: [
							{
								message: { role: "assistant", content: "streamed" },
								finish_reason: "stop",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const handle = await startTranslator({
			upstreamBaseUrl: "https://openrouter.ai/api",
			apiKey: "key",
			fetchFn: fetchFn as unknown as typeof fetch,
		});
		try {
			const resp = await fetch(`${handle.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "m",
					messages: [{ role: "user", content: "go" }],
					stream: true,
				}),
			});
			expect(resp.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const text = await resp.text();
			expect(text).toContain("event: message_start");
			expect(text).toContain("streamed");
			// OpenRouter base keeps its /api prefix.
			expect(fetchFn.mock.calls[0]![0]).toBe(
				"https://openrouter.ai/api/v1/chat/completions",
			);
		} finally {
			await handle.close();
		}
	});

	it("surfaces a provider error status wrapped in the Messages error shape", async () => {
		const fetchFn = vi.fn(
			async () =>
				new Response("bad key", {
					status: 401,
					headers: { "content-type": "text/plain" },
				}),
		);
		const handle = await startTranslator({
			upstreamBaseUrl: "https://api.openai.com",
			apiKey: "key",
			fetchFn: fetchFn as unknown as typeof fetch,
		});
		try {
			const resp = await fetch(`${handle.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "m",
					messages: [{ role: "user", content: "x" }],
				}),
			});
			expect(resp.status).toBe(401);
			const json = (await resp.json()) as { type: string };
			expect(json.type).toBe("error");
		} finally {
			await handle.close();
		}
	});
});
