import { describe, expect, it } from "vitest";
import type { LlmAuth } from "../credentials.js";
import { AnthropicAdapter } from "./anthropic.js";
import { adapterFor } from "./index.js";
import {
	OPENAI_BASE_URL,
	OPENROUTER_BASE_URL,
	OpenAiCompatibleAdapter,
} from "./openai-compatible.js";

const anthropicApiKey: LlmAuth = {
	type: "anthropic_api_key",
	token: "sk-ant-token",
};
const claudeOauth: LlmAuth = { type: "claude_oauth", token: "oauth-token" };
const custom: LlmAuth = {
	type: "custom",
	token: "custom-token",
	baseUrl: "https://proxy.example.com",
	model: "claude-3-5-sonnet",
};
const openaiAuth: LlmAuth = {
	type: "openai",
	token: "sk-openai-token",
	model: "gpt-4o-mini",
};
const openrouterAuth: LlmAuth = {
	type: "openrouter",
	token: "or-token",
	model: "openrouter/auto",
};

describe("adapterFor", () => {
	it("returns the AnthropicAdapter for anthropic_api_key", () => {
		expect(adapterFor(anthropicApiKey)).toBe(AnthropicAdapter);
	});

	it("returns the AnthropicAdapter for claude_oauth", () => {
		expect(adapterFor(claudeOauth)).toBe(AnthropicAdapter);
	});

	it("returns the AnthropicAdapter for custom", () => {
		expect(adapterFor(custom)).toBe(AnthropicAdapter);
	});

	it("returns an OpenAiCompatibleAdapter targeting OpenAI for openai", () => {
		const adapter = adapterFor(openaiAuth);
		expect(adapter).toBeInstanceOf(OpenAiCompatibleAdapter);
		expect(adapter.endpoint(openaiAuth).url).toBe(
			`${OPENAI_BASE_URL}/v1/chat/completions`,
		);
	});

	it("returns an OpenAiCompatibleAdapter targeting OpenRouter for openrouter", () => {
		const adapter = adapterFor(openrouterAuth);
		expect(adapter).toBeInstanceOf(OpenAiCompatibleAdapter);
		expect(adapter.endpoint(openrouterAuth).url).toBe(
			`${OPENROUTER_BASE_URL}/v1/chat/completions`,
		);
	});

	it("reuses the same adapter instance across calls for a given provider", () => {
		expect(adapterFor(openaiAuth)).toBe(adapterFor(openaiAuth));
		expect(adapterFor(openrouterAuth)).toBe(adapterFor(openrouterAuth));
		// openai and openrouter must be distinct instances (different base URLs).
		expect(adapterFor(openaiAuth)).not.toBe(adapterFor(openrouterAuth));
	});
});
