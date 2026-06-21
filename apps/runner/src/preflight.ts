import type { TaskSpec } from "@anywarecode/shared";

/**
 * `claw doctor`-style preflight: cheap, static validation of the run's
 * configuration BEFORE the engine is invoked, so a misconfiguration surfaces as
 * a clear message instead of a deep SDK stack trace. Runs after the runner has
 * set exactly one credential env set (see index.ts), so it can assert that
 * invariant directly. Returns a list of problems; empty = good to go.
 */
export function preflight(
	spec: TaskSpec,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	const problems: string[] = [];

	// The load-bearing invariant: never both first-party credential envs at once
	// (the SDK rejects the request) and never zero.
	const apiKey = Boolean(env.ANTHROPIC_API_KEY);
	const oauth = Boolean(env.CLAUDE_CODE_OAUTH_TOKEN);
	const custom = Boolean(env.ANTHROPIC_BASE_URL);
	if (apiKey && oauth) {
		problems.push(
			"both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set; the SDK will reject this",
		);
	}
	if ([apiKey, oauth, custom].filter(Boolean).length === 0) {
		problems.push("no LLM credential is configured");
	}

	// The env set must match the declared auth type.
	switch (spec.llmAuth.type) {
		case "anthropic_api_key":
			if (!apiKey)
				problems.push(
					"anthropic_api_key auth but ANTHROPIC_API_KEY is unset",
				);
			break;
		case "claude_oauth":
			if (!oauth)
				problems.push(
					"claude_oauth auth but CLAUDE_CODE_OAUTH_TOKEN is unset",
				);
			break;
		case "custom":
			if (!custom)
				problems.push("custom auth but ANTHROPIC_BASE_URL is unset");
			if (!env.ANTHROPIC_MODEL)
				problems.push("custom auth but ANTHROPIC_MODEL is unset");
			break;
		case "openai":
		case "openrouter": {
			// OpenAI-compatible providers run through the localhost translation
			// sidecar: the runner points ANTHROPIC_BASE_URL at the translator and
			// forwards the effective model as ANTHROPIC_MODEL. Assert both are wired
			// and that the model id is well-formed; the `claude-` first-party check
			// below is intentionally skipped for these types.
			const type = spec.llmAuth.type;
			if (!custom) {
				problems.push(
					`${type} auth but ANTHROPIC_BASE_URL (translator url) is unset`,
				);
			}
			const model = env.ANTHROPIC_MODEL;
			if (!model) {
				problems.push(`${type} auth but ANTHROPIC_MODEL is unset`);
			} else if (!/^[\w./:-]+$/.test(model)) {
				// OpenAI-compatible model ids commonly carry a vendor prefix
				// (e.g. "openrouter/auto", "anthropic/claude-3.5-sonnet"), so a `/`
				// is allowed here unlike the first-party id check.
				problems.push(`requested model id is malformed: ${model}`);
			}
			break;
		}
	}

	// A requested model id should be well-formed (custom providers ignore it).
	if (spec.model && !/^[\w.:-]+$/.test(spec.model)) {
		problems.push(`requested model id is malformed: ${spec.model}`);
	}
	// First-party auth only serves Claude models — catch an obviously-wrong id
	// before it becomes a deep SDK error. `custom` and the OpenAI-compatible
	// providers (openai/openrouter) reach non-Anthropic models through their own
	// endpoint/translator, so they are exempt from this check.
	if (
		spec.model &&
		spec.llmAuth.type !== "custom" &&
		spec.llmAuth.type !== "openai" &&
		spec.llmAuth.type !== "openrouter" &&
		!spec.model.startsWith("claude-")
	) {
		problems.push(
			`"${spec.model}" is not a Claude model id for first-party auth`,
		);
	}

	return problems;
}

/**
 * Cheap liveness probe for the translation sidecar used by `openai`/`openrouter`
 * providers. The translator exposes a `GET /` health route returning
 * `{ ok: true }`; if it can't be reached the task can't run, so surface a clear
 * problem string (consumed alongside `preflight`'s static checks). Returns
 * `null` when the translator is reachable.
 */
export async function checkTranslatorReachable(
	baseUrl: string | undefined,
	fetchFn: typeof fetch = fetch,
): Promise<string | null> {
	if (!baseUrl) {
		return "translator base URL (ANTHROPIC_BASE_URL) is unset";
	}
	try {
		const res = await fetchFn(baseUrl, { method: "GET" });
		if (!res.ok) {
			return `translator health check failed: ${res.status}`;
		}
		return null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return `translator is unreachable: ${message}`;
	}
}
