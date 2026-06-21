import { describe, expect, it } from "vitest";
import type { ChatContext } from "../chat.js";
import type { LlmAuth } from "../credentials.js";
import {
	OPENAI_BASE_URL,
	OPENROUTER_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";

const openai = new OpenAiCompatibleAdapter(OPENAI_BASE_URL);
const openrouter = new OpenAiCompatibleAdapter(OPENROUTER_BASE_URL);

const openaiAuth: LlmAuth = {
	type: "openai",
	token: "sk-secret-token",
	model: "gpt-4o-mini",
};
const openrouterAuth: LlmAuth = {
	type: "openrouter",
	token: "or-secret-token",
	model: "openrouter/auto",
};

const ctx: ChatContext = {
	history: [],
	mention: { author: "alice", text: "hey bot" },
	channelName: "general",
	repoFullName: "acme/widgets",
};

describe("OpenAiCompatibleAdapter.endpoint", () => {
	it("targets the OpenAI chat-completions endpoint with a Bearer header", () => {
		const { url, headers } = openai.endpoint(openaiAuth);
		expect(url).toBe("https://api.openai.com/v1/chat/completions");
		expect(headers).toEqual({ authorization: "Bearer sk-secret-token" });
	});

	it("targets the OpenRouter chat-completions endpoint", () => {
		const { url, headers } = openrouter.endpoint(openrouterAuth);
		expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(headers.authorization).toBe("Bearer or-secret-token");
	});

	it("strips a trailing slash from the base URL", () => {
		const a = new OpenAiCompatibleAdapter("https://api.openai.com/");
		expect(a.endpoint(openaiAuth).url).toBe(
			"https://api.openai.com/v1/chat/completions",
		);
	});
});

describe("OpenAiCompatibleAdapter.effectiveModel", () => {
	it("uses the credential model when present", () => {
		expect(openai.effectiveModel(openaiAuth, "fallback")).toBe("gpt-4o-mini");
	});

	it("falls back when the credential model is blank", () => {
		const blank: LlmAuth = { type: "openai", token: "t", model: "   " };
		expect(openai.effectiveModel(blank, "gpt-4o-mini")).toBe("gpt-4o-mini");
	});
});

describe("OpenAiCompatibleAdapter request bodies", () => {
	it("builds a classify body with system-first and a forced decide function tool", () => {
		const body = openai.buildClassifyBody("gpt-4o", ctx) as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			tools: Array<{ type: string; function: { name: string } }>;
			tool_choice: { type: string; function: { name: string } };
		};
		expect(body.model).toBe("gpt-4o");
		expect(body.messages[0]?.role).toBe("system");
		expect(body.messages[1]?.role).toBe("user");
		expect(body.tools[0]?.type).toBe("function");
		expect(body.tools[0]?.function.name).toBe("decide");
		expect(body.tool_choice).toEqual({
			type: "function",
			function: { name: "decide" },
		});
	});

	it("builds a plain reply body carrying the model", () => {
		const body = openai.buildReplyBody("gpt-4o", ctx) as {
			model: string;
			messages: Array<{ role: string }>;
			tools?: unknown;
		};
		expect(body.model).toBe("gpt-4o");
		expect(body.messages[0]?.role).toBe("system");
		expect(body.tools).toBeUndefined();
	});

	it("builds a minimal probe body (single user message, max_tokens 1)", () => {
		const body = openai.buildProbeBody("gpt-4o") as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			max_tokens: number;
		};
		expect(body).toEqual({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 1,
		});
	});
});

describe("OpenAiCompatibleAdapter.extractDecision", () => {
	function bodyWith(args: unknown) {
		return {
			choices: [
				{ message: { tool_calls: [{ function: { arguments: args } }] } },
			],
		};
	}

	it("parses tool-call arguments and validates against the schema", () => {
		const decision = openai.extractDecision(
			bodyWith(JSON.stringify({ action: "reply", reply_text: "hi there" })),
		);
		expect(decision).toEqual({ action: "reply", reply_text: "hi there" });
	});

	it("returns null when arguments are missing", () => {
		expect(openai.extractDecision({ choices: [{ message: {} }] })).toBeNull();
	});

	it("returns null on unparseable JSON", () => {
		expect(openai.extractDecision(bodyWith("{not json"))).toBeNull();
	});

	it("returns null on a schema-invalid decision (reply without reply_text)", () => {
		expect(
			openai.extractDecision(bodyWith(JSON.stringify({ action: "reply" }))),
		).toBeNull();
	});

	it("returns null on an empty body", () => {
		expect(openai.extractDecision(null)).toBeNull();
		expect(openai.extractDecision({})).toBeNull();
	});
});

describe("OpenAiCompatibleAdapter.extractReplyText", () => {
	it("reads choices[0].message.content", () => {
		const text = openai.extractReplyText({
			choices: [{ message: { content: "  hello world  " } }],
		});
		expect(text).toBe("hello world");
	});

	it("returns empty string when content is absent or non-string", () => {
		expect(openai.extractReplyText({ choices: [{ message: {} }] })).toBe("");
		expect(openai.extractReplyText(null)).toBe("");
	});
});

describe("OpenAiCompatibleAdapter.isProviderErrorBody", () => {
	it("always returns false (status ladder governs)", () => {
		expect(openai.isProviderErrorBody({ type: "error" })).toBe(false);
		expect(openai.isProviderErrorBody(null)).toBe(false);
	});
});

describe("OpenAiCompatibleAdapter.isModelUnavailable", () => {
	it("maps a 404 model_not_found body to true", () => {
		expect(
			openai.isModelUnavailable(404, {
				error: {
					code: "model_not_found",
					message: "The model does not exist",
				},
			}),
		).toBe(true);
	});

	it("maps a 400 with param=model to true", () => {
		expect(
			openrouter.isModelUnavailable(400, {
				error: { param: "model", message: "unknown model" },
			}),
		).toBe(true);
	});

	it("maps a bare 404 with no error body to true", () => {
		expect(openai.isModelUnavailable(404, null)).toBe(true);
	});

	it("does not flag auth or rate-limit failures", () => {
		expect(
			openai.isModelUnavailable(401, { error: { code: "invalid_api_key" } }),
		).toBe(false);
		expect(openai.isModelUnavailable(429, {})).toBe(false);
	});

	it("does not flag a 400 parameter error unrelated to the model", () => {
		expect(
			openai.isModelUnavailable(400, {
				error: { param: "max_tokens", message: "must be positive" },
			}),
		).toBe(false);
	});
});

describe("OpenAiCompatibleAdapter.parseRateLimitInfo", () => {
	function headersFrom(map: Record<string, string>) {
		return (name: string) => map[name.toLowerCase()] ?? null;
	}

	it("derives reset and retryAfter from retry-after seconds", () => {
		const info = openai.parseRateLimitInfo({
			headers: headersFrom({ "retry-after": "30" }),
			receivedAtMs: 1000,
		});
		expect(info.retryAfterMs).toBe(30000);
		expect(info.resetTimeMs).toBe(1000 + 30000);
	});

	it("reads x-ratelimit-reset-requests as epoch seconds when no retry-after", () => {
		const info = openrouter.parseRateLimitInfo({
			headers: headersFrom({ "x-ratelimit-reset-requests": "5" }),
			receivedAtMs: 1000,
		});
		expect(info.retryAfterMs).toBeNull();
		expect(info.resetTimeMs).toBe(5000);
	});

	it("clamps a reset earlier than receipt up to receivedAtMs", () => {
		const info = openai.parseRateLimitInfo({
			headers: headersFrom({ "x-ratelimit-reset-requests": "1" }),
			receivedAtMs: 10000,
		});
		expect(info.resetTimeMs).toBe(10000);
	});

	it("returns null reset when no usable headers present", () => {
		const info = openai.parseRateLimitInfo({
			headers: headersFrom({}),
			receivedAtMs: 1000,
		});
		expect(info.resetTimeMs).toBeNull();
		expect(info.retryAfterMs).toBeNull();
	});
});
