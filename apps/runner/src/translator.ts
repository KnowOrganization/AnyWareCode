import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ProxyAgent } from "undici";

/**
 * Messages↔Chat-Completions translation sidecar.
 *
 * The Claude Agent SDK speaks exactly one wire protocol — the Anthropic
 * Messages API (`POST {base}/v1/messages`, content blocks, `tool_use`). OpenAI
 * and OpenRouter speak the OpenAI Chat Completions shape instead. Rather than
 * teach the SDK a second protocol, the runner points `ANTHROPIC_BASE_URL` at
 * this localhost translator: it accepts the SDK's Messages requests, forwards
 * an equivalent Chat Completions request to the real provider, and translates
 * the response back into the Messages shape the SDK expects — including mapping
 * `tool_use`/`tool_result` blocks to/from OpenAI function calls.
 *
 * Everything network-facing is funneled through pure translation functions
 * (`messagesToChatCompletions`, `chatCompletionToMessages`, `synthesizeSSE`) so
 * the shape mapping is unit-testable without a server or a real provider.
 */

// ---------------------------------------------------------------------------
// Anthropic Messages shapes (subset the SDK actually uses).
// ---------------------------------------------------------------------------

interface AnthropicTextBlock {
	type: "text";
	text: string;
}
interface AnthropicToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
}
interface AnthropicToolResultBlock {
	type: "tool_result";
	tool_use_id: string;
	content: unknown;
	is_error?: boolean;
}
type AnthropicContentBlock =
	| AnthropicTextBlock
	| AnthropicToolUseBlock
	| AnthropicToolResultBlock
	| { type: string; [k: string]: unknown };

interface AnthropicMessage {
	role: "user" | "assistant";
	content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
	name: string;
	description?: string;
	input_schema?: unknown;
}

interface AnthropicToolChoice {
	type: "auto" | "any" | "tool" | string;
	name?: string;
}

export interface AnthropicMessagesRequest {
	model: string;
	max_tokens?: number;
	system?:
		| string
		| Array<AnthropicTextBlock | { type: string; [k: string]: unknown }>;
	messages: AnthropicMessage[];
	tools?: AnthropicTool[];
	tool_choice?: AnthropicToolChoice;
	temperature?: number;
	top_p?: number;
	stop_sequences?: string[];
	stream?: boolean;
	metadata?: unknown;
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions shapes (subset).
// ---------------------------------------------------------------------------

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OpenAiMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
}

export interface ChatCompletionsRequest {
	model: string;
	messages: OpenAiMessage[];
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	stop?: string[];
	tools?: Array<{
		type: "function";
		function: { name: string; description?: string; parameters: unknown };
	}>;
	tool_choice?:
		| "auto"
		| "required"
		| { type: "function"; function: { name: string } };
	stream?: boolean;
}

export interface ChatCompletionsResponse {
	id?: string;
	model?: string;
	choices?: Array<{
		index?: number;
		message?: {
			role?: string;
			content?: string | null;
			tool_calls?: Array<{
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
}

export interface AnthropicMessagesResponse {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
	stop_reason: string;
	stop_sequence: string | null;
	usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Request translation: Anthropic Messages → OpenAI Chat Completions.
// ---------------------------------------------------------------------------

/** Anthropic `system` may be a string or an array of text blocks; flatten it. */
function systemToText(
	system: AnthropicMessagesRequest["system"],
): string | undefined {
	if (system === undefined) return undefined;
	if (typeof system === "string") return system;
	const text = system
		.map((b) =>
			b && typeof b === "object" && "text" in b ? String(b.text) : "",
		)
		.filter(Boolean)
		.join("\n");
	return text || undefined;
}

/** Tool-result content can be a string or an array of blocks; flatten to text. */
function toolResultToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => {
				if (typeof b === "string") return b;
				if (b && typeof b === "object" && "text" in b) {
					return String((b as { text: unknown }).text);
				}
				return JSON.stringify(b);
			})
			.join("\n");
	}
	if (content === undefined || content === null) return "";
	return JSON.stringify(content);
}

/**
 * Translate one Anthropic message into zero or more OpenAI messages. An
 * assistant message with `tool_use` blocks becomes one assistant message
 * carrying `tool_calls`; a user message with `tool_result` blocks becomes one
 * `role:"tool"` message per result (emitted before any plain user text so they
 * stay adjacent to the assistant turn that requested them, as OpenAI requires).
 */
function translateMessage(msg: AnthropicMessage): OpenAiMessage[] {
	if (typeof msg.content === "string") {
		return [{ role: msg.role, content: msg.content }];
	}

	const out: OpenAiMessage[] = [];
	const textParts: string[] = [];
	const toolCalls: OpenAiToolCall[] = [];
	const toolMessages: OpenAiMessage[] = [];

	for (const block of msg.content) {
		switch (block.type) {
			case "text":
				textParts.push(String((block as AnthropicTextBlock).text ?? ""));
				break;
			case "tool_use": {
				const b = block as AnthropicToolUseBlock;
				toolCalls.push({
					id: b.id,
					type: "function",
					function: {
						name: b.name,
						arguments: JSON.stringify(b.input ?? {}),
					},
				});
				break;
			}
			case "tool_result": {
				const b = block as AnthropicToolResultBlock;
				toolMessages.push({
					role: "tool",
					tool_call_id: b.tool_use_id,
					content: toolResultToText(b.content),
				});
				break;
			}
			default:
				// image / unknown blocks: best-effort textual placeholder so the turn
				// is never dropped silently.
				textParts.push(`[${block.type}]`);
		}
	}

	// Tool results first — they must follow the assistant tool_calls turn.
	out.push(...toolMessages);

	if (msg.role === "assistant") {
		if (textParts.length > 0 || toolCalls.length > 0) {
			out.push({
				role: "assistant",
				content: textParts.length > 0 ? textParts.join("\n") : null,
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			});
		}
	} else if (textParts.length > 0) {
		out.push({ role: "user", content: textParts.join("\n") });
	}

	return out;
}

function translateToolChoice(
	choice: AnthropicToolChoice | undefined,
): ChatCompletionsRequest["tool_choice"] {
	if (!choice) return undefined;
	switch (choice.type) {
		case "auto":
			return "auto";
		case "any":
			return "required";
		case "tool":
			return choice.name
				? { type: "function", function: { name: choice.name } }
				: "required";
		default:
			return undefined;
	}
}

/** Pure mapping of an Anthropic Messages request onto a Chat Completions request. */
export function messagesToChatCompletions(
	req: AnthropicMessagesRequest,
): ChatCompletionsRequest {
	const messages: OpenAiMessage[] = [];
	const systemText = systemToText(req.system);
	if (systemText) messages.push({ role: "system", content: systemText });
	for (const m of req.messages) messages.push(...translateMessage(m));

	const out: ChatCompletionsRequest = {
		model: req.model,
		messages,
	};
	if (typeof req.max_tokens === "number") out.max_tokens = req.max_tokens;
	if (typeof req.temperature === "number") out.temperature = req.temperature;
	if (typeof req.top_p === "number") out.top_p = req.top_p;
	if (req.stop_sequences && req.stop_sequences.length > 0) {
		out.stop = req.stop_sequences;
	}
	if (req.tools && req.tools.length > 0) {
		out.tools = req.tools.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				...(t.description ? { description: t.description } : {}),
				parameters: t.input_schema ?? { type: "object", properties: {} },
			},
		}));
		const tc = translateToolChoice(req.tool_choice);
		if (tc) out.tool_choice = tc;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI Chat Completions → Anthropic Messages.
// ---------------------------------------------------------------------------

/** OpenAI finish_reason → Anthropic stop_reason. */
function mapFinishReason(reason: string | null | undefined): string {
	switch (reason) {
		case "length":
			return "max_tokens";
		case "tool_calls":
		case "function_call":
			return "tool_use";
		case "stop":
		default:
			return "end_turn";
	}
}

function safeParseArguments(args: string | undefined): unknown {
	if (!args) return {};
	try {
		return JSON.parse(args);
	} catch {
		// A model occasionally emits non-JSON argument text; keep it as a raw
		// string rather than dropping the tool call entirely.
		return { _raw: args };
	}
}

/** Pure mapping of a Chat Completions response onto an Anthropic Messages response. */
export function chatCompletionToMessages(
	resp: ChatCompletionsResponse,
	fallbackModel: string,
): AnthropicMessagesResponse {
	const choice = resp.choices?.[0];
	const message = choice?.message;
	const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];

	if (
		message?.content &&
		typeof message.content === "string" &&
		message.content.length > 0
	) {
		content.push({ type: "text", text: message.content });
	}
	for (const tc of message?.tool_calls ?? []) {
		content.push({
			type: "tool_use",
			id: tc.id ?? `toolu_${Math.random().toString(36).slice(2)}`,
			name: tc.function?.name ?? "",
			input: safeParseArguments(tc.function?.arguments),
		});
	}
	// The Messages API always returns at least one content block.
	if (content.length === 0) content.push({ type: "text", text: "" });

	const hasToolUse = content.some((b) => b.type === "tool_use");
	const stopReason = hasToolUse
		? "tool_use"
		: mapFinishReason(choice?.finish_reason);

	return {
		id: resp.id ?? `msg_${Math.random().toString(36).slice(2)}`,
		type: "message",
		role: "assistant",
		model: resp.model ?? fallbackModel,
		content,
		stop_reason: stopReason,
		stop_sequence: null,
		usage: {
			input_tokens: resp.usage?.prompt_tokens ?? 0,
			output_tokens: resp.usage?.completion_tokens ?? 0,
		},
	};
}

// ---------------------------------------------------------------------------
// SSE synthesis: the SDK requests `stream:true` and consumes the Anthropic
// event stream. We fetch the provider non-streaming and replay the complete
// response as a well-formed Messages SSE sequence.
// ---------------------------------------------------------------------------

function sseEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Render a complete Messages response as an Anthropic-style SSE event stream. */
export function synthesizeSSE(msg: AnthropicMessagesResponse): string {
	const parts: string[] = [];

	parts.push(
		sseEvent("message_start", {
			type: "message_start",
			message: {
				id: msg.id,
				type: "message",
				role: "assistant",
				model: msg.model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: msg.usage.input_tokens, output_tokens: 0 },
			},
		}),
	);

	msg.content.forEach((block, index) => {
		if (block.type === "text") {
			parts.push(
				sseEvent("content_block_start", {
					type: "content_block_start",
					index,
					content_block: { type: "text", text: "" },
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index,
					delta: { type: "text_delta", text: block.text },
				}),
				sseEvent("content_block_stop", {
					type: "content_block_stop",
					index,
				}),
			);
		} else {
			parts.push(
				sseEvent("content_block_start", {
					type: "content_block_start",
					index,
					content_block: {
						type: "tool_use",
						id: block.id,
						name: block.name,
						input: {},
					},
				}),
				sseEvent("content_block_delta", {
					type: "content_block_delta",
					index,
					delta: {
						type: "input_json_delta",
						partial_json: JSON.stringify(block.input ?? {}),
					},
				}),
				sseEvent("content_block_stop", {
					type: "content_block_stop",
					index,
				}),
			);
		}
	});

	parts.push(
		sseEvent("message_delta", {
			type: "message_delta",
			delta: {
				stop_reason: msg.stop_reason,
				stop_sequence: msg.stop_sequence,
			},
			usage: { output_tokens: msg.usage.output_tokens },
		}),
		sseEvent("message_stop", { type: "message_stop" }),
	);

	return parts.join("");
}

// ---------------------------------------------------------------------------
// HTTP sidecar.
// ---------------------------------------------------------------------------

export interface StartTranslatorOptions {
	/** Provider base URL, e.g. `https://api.openai.com` or `https://openrouter.ai/api`. */
	upstreamBaseUrl: string;
	/** Provider credential, forwarded as `Authorization: Bearer <key>`. */
	apiKey: string;
	/** Injected for tests; defaults to the global `fetch`. */
	fetchFn?: typeof fetch;
	/** Extra headers to send upstream (e.g. OpenRouter attribution headers). */
	extraHeaders?: Record<string, string>;
}

export interface TranslatorHandle {
	/** The bound `http://127.0.0.1:<port>` URL to use as `ANTHROPIC_BASE_URL`. */
	url: string;
	port: number;
	close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function anthropicError(message: string): string {
	return JSON.stringify({
		type: "error",
		error: { type: "api_error", message },
	});
}

function trimTrailingSlash(url: string): string {
	return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Start the translation sidecar bound to an ephemeral `127.0.0.1` port and
 * resolve once it is listening. The returned handle's `url` is what the runner
 * sets as `ANTHROPIC_BASE_URL`; the SDK appends `/v1/messages`.
 */
export function startTranslator(
	opts: StartTranslatorOptions,
): Promise<TranslatorHandle> {
	const fetchFn = opts.fetchFn ?? fetch;
	const upstreamUrl = `${trimTrailingSlash(opts.upstreamBaseUrl)}/v1/chat/completions`;

	// In prod the runner is on an internal-only network whose sole exit is the
	// egress proxy. Node's global `fetch` (undici) ignores HTTPS_PROXY, so the
	// upstream provider call must be dispatched explicitly through a ProxyAgent;
	// without it the request has no route off the container. NO_PROXY is not
	// consulted here because the upstream host is always the remote provider.
	const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
	const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

	const server: Server = createServer((req, res) => {
		void (async () => {
			// Cheap reachability probe for preflight/health checks.
			if (req.method === "GET") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			if (req.method !== "POST" || !req.url?.includes("/v1/messages")) {
				res.writeHead(404, { "content-type": "application/json" });
				res.end(
					anthropicError(`unsupported route: ${req.method} ${req.url}`),
				);
				return;
			}

			let anthropicReq: AnthropicMessagesRequest;
			try {
				anthropicReq = JSON.parse(
					await readBody(req),
				) as AnthropicMessagesRequest;
			} catch {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(anthropicError("invalid JSON request body"));
				return;
			}

			const wantsStream = anthropicReq.stream === true;
			const chatReq = messagesToChatCompletions(anthropicReq);
			chatReq.stream = false; // we always fetch non-streaming and replay.

			let upstream: Response;
			try {
				upstream = await fetchFn(upstreamUrl, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${opts.apiKey}`,
						...(opts.extraHeaders ?? {}),
					},
					body: JSON.stringify(chatReq),
					// undici reads `dispatcher` off the init even though it's absent
					// from the DOM RequestInit type; route through the egress proxy.
					...(dispatcher ? { dispatcher } : {}),
				} as RequestInit);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				res.writeHead(502, { "content-type": "application/json" });
				res.end(anthropicError(`upstream request failed: ${message}`));
				return;
			}

			const rawBody = await upstream.text();
			if (!upstream.ok) {
				// Surface the provider's status so the SDK's own error handling (auth,
				// rate-limit, model errors) classifies it; wrap the body in the
				// Messages error envelope the SDK expects.
				res.writeHead(upstream.status, {
					"content-type": "application/json",
				});
				res.end(
					anthropicError(
						rawBody || `provider returned ${upstream.status}`,
					),
				);
				return;
			}

			let chatResp: ChatCompletionsResponse;
			try {
				chatResp = JSON.parse(rawBody) as ChatCompletionsResponse;
			} catch {
				res.writeHead(502, { "content-type": "application/json" });
				res.end(anthropicError("provider returned non-JSON response"));
				return;
			}

			const messagesResp = chatCompletionToMessages(
				chatResp,
				anthropicReq.model,
			);

			if (wantsStream) {
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				res.end(synthesizeSSE(messagesResp));
			} else {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify(messagesResp));
			}
		})().catch((err: unknown) => {
			const message = err instanceof Error ? err.message : String(err);
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "application/json" });
			}
			res.end(anthropicError(`translator error: ${message}`));
		});
	});

	return new Promise<TranslatorHandle>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${addr.port}`,
				port: addr.port,
				close: () =>
					new Promise<void>((res, rej) =>
						server.close((err) => (err ? rej(err) : res())),
					),
			});
		});
	});
}
