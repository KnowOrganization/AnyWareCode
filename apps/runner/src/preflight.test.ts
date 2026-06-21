import { describe, expect, it } from "vitest";
import { checkTranslatorReachable, preflight } from "./preflight.js";
import { createTaskSpec as spec } from "./test-fixtures.js";

describe("preflight", () => {
	it("passes with exactly the matching credential env", () => {
		expect(preflight(spec(), { ANTHROPIC_API_KEY: "k" })).toEqual([]);
	});

	it("flags both first-party credentials set at once", () => {
		const problems = preflight(spec(), {
			ANTHROPIC_API_KEY: "k",
			CLAUDE_CODE_OAUTH_TOKEN: "o",
		});
		expect(problems.join(" ")).toMatch(/both ANTHROPIC_API_KEY/);
	});

	it("flags a missing credential", () => {
		expect(preflight(spec(), {})).toContain(
			"no LLM credential is configured",
		);
	});

	it("flags an env/auth-type mismatch", () => {
		const problems = preflight(
			spec({ llmAuth: { type: "claude_oauth", token: "o" } }),
			{ ANTHROPIC_API_KEY: "k" },
		);
		expect(problems.join(" ")).toMatch(/CLAUDE_CODE_OAUTH_TOKEN is unset/);
	});

	it("validates custom auth env set", () => {
		const ok = preflight(
			spec({
				llmAuth: {
					type: "custom",
					token: "t",
					baseUrl: "https://x.dev",
					model: "m",
				},
			}),
			{
				ANTHROPIC_BASE_URL: "https://x.dev",
				ANTHROPIC_AUTH_TOKEN: "t",
				ANTHROPIC_MODEL: "m",
			},
		);
		expect(ok).toEqual([]);
	});

	it("rejects a malformed model id", () => {
		const problems = preflight(spec({ model: "bad model!" }), {
			ANTHROPIC_API_KEY: "k",
		});
		expect(problems.join(" ")).toMatch(/malformed/);
	});

	it("rejects a non-Claude model for first-party auth", () => {
		const problems = preflight(spec({ model: "gpt-4o" }), {
			ANTHROPIC_API_KEY: "k",
		});
		expect(problems.join(" ")).toMatch(/not a Claude model/);
	});

	it("allows any model for custom providers", () => {
		const ok = preflight(
			spec({
				model: "deepseek-coder",
				llmAuth: {
					type: "custom",
					token: "t",
					baseUrl: "https://x.dev",
					model: "deepseek-coder",
				},
			}),
			{
				ANTHROPIC_BASE_URL: "https://x.dev",
				ANTHROPIC_AUTH_TOKEN: "t",
				ANTHROPIC_MODEL: "deepseek-coder",
			},
		);
		expect(ok).toEqual([]);
	});

	it("validates openai auth wired through the translator", () => {
		const ok = preflight(
			spec({
				llmAuth: {
					type: "openai",
					token: "sk-openai",
					model: "gpt-4o-mini",
				},
			}),
			{
				ANTHROPIC_BASE_URL: "http://127.0.0.1:5123",
				ANTHROPIC_MODEL: "gpt-4o-mini",
			},
		);
		expect(ok).toEqual([]);
	});

	it("validates openrouter auth with a vendor-prefixed model id", () => {
		const ok = preflight(
			spec({
				llmAuth: {
					type: "openrouter",
					token: "sk-or",
					model: "openrouter/auto",
				},
			}),
			{
				ANTHROPIC_BASE_URL: "http://127.0.0.1:5123",
				ANTHROPIC_MODEL: "openrouter/auto",
			},
		);
		expect(ok).toEqual([]);
	});

	it("flags a missing translator base URL for openai", () => {
		const problems = preflight(
			spec({
				llmAuth: {
					type: "openai",
					token: "sk-openai",
					model: "gpt-4o-mini",
				},
			}),
			{ ANTHROPIC_MODEL: "gpt-4o-mini" },
		);
		expect(problems.join(" ")).toMatch(
			/ANTHROPIC_BASE_URL \(translator url\) is unset/,
		);
	});

	it("flags a missing ANTHROPIC_MODEL for openrouter", () => {
		const problems = preflight(
			spec({
				llmAuth: {
					type: "openrouter",
					token: "sk-or",
					model: "openrouter/auto",
				},
			}),
			{ ANTHROPIC_BASE_URL: "http://127.0.0.1:5123" },
		);
		expect(problems.join(" ")).toMatch(
			/openrouter auth but ANTHROPIC_MODEL is unset/,
		);
	});

	it("flags a malformed openai model id", () => {
		const problems = preflight(
			spec({
				llmAuth: {
					type: "openai",
					token: "sk-openai",
					model: "bad model!",
				},
			}),
			{
				ANTHROPIC_BASE_URL: "http://127.0.0.1:5123",
				ANTHROPIC_MODEL: "bad model!",
			},
		);
		expect(problems.join(" ")).toMatch(/malformed/);
	});

	it("skips the Claude-model check for openai/openrouter", () => {
		const ok = preflight(
			spec({
				model: "gpt-4o",
				llmAuth: { type: "openai", token: "sk-openai", model: "gpt-4o" },
			}),
			{
				ANTHROPIC_BASE_URL: "http://127.0.0.1:5123",
				ANTHROPIC_MODEL: "gpt-4o",
			},
		);
		expect(ok).toEqual([]);
	});
});

describe("checkTranslatorReachable", () => {
	it("returns null when the translator health route responds ok", async () => {
		const fetchFn = (async () =>
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
			})) as unknown as typeof fetch;
		expect(
			await checkTranslatorReachable("http://127.0.0.1:5123", fetchFn),
		).toBeNull();
	});

	it("reports an unset base URL", async () => {
		expect(await checkTranslatorReachable(undefined)).toMatch(/unset/);
	});

	it("reports an unreachable translator", async () => {
		const fetchFn = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		const problem = await checkTranslatorReachable(
			"http://127.0.0.1:5123",
			fetchFn,
		);
		expect(problem).toMatch(/unreachable/);
	});

	it("reports a non-ok health status", async () => {
		const fetchFn = (async () =>
			new Response("", { status: 502 })) as unknown as typeof fetch;
		const problem = await checkTranslatorReachable(
			"http://127.0.0.1:5123",
			fetchFn,
		);
		expect(problem).toMatch(/health check failed: 502/);
	});
});
