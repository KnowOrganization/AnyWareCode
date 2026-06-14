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
      if (!apiKey) problems.push("anthropic_api_key auth but ANTHROPIC_API_KEY is unset");
      break;
    case "claude_oauth":
      if (!oauth) problems.push("claude_oauth auth but CLAUDE_CODE_OAUTH_TOKEN is unset");
      break;
    case "custom":
      if (!custom) problems.push("custom auth but ANTHROPIC_BASE_URL is unset");
      if (!env.ANTHROPIC_MODEL) problems.push("custom auth but ANTHROPIC_MODEL is unset");
      break;
  }

  // A requested model id should be well-formed (custom providers ignore it).
  if (spec.model && !/^[\w.:-]+$/.test(spec.model)) {
    problems.push(`requested model id is malformed: ${spec.model}`);
  }
  // First-party auth only serves Claude models — catch an obviously-wrong id
  // before it becomes a deep SDK error.
  if (
    spec.model &&
    spec.llmAuth.type !== "custom" &&
    !spec.model.startsWith("claude-")
  ) {
    problems.push(`"${spec.model}" is not a Claude model id for first-party auth`);
  }

  return problems;
}
