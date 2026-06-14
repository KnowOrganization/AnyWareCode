import type { TaskSpec } from "@anywherecode/shared";

/** Minimal valid TaskSpec for tests; override only what a case cares about. */
export function createTaskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    taskId: "t",
    repo: "o/r",
    branch: "anywherecode/t",
    baseBranch: "main",
    prompt: "do it",
    mode: "code",
    engine: "claude",
    transcript: [],
    resumeBranch: false,
    githubToken: "gh",
    llmAuth: { type: "anthropic_api_key", token: "sk" },
    mcpServers: [],
    ...overrides,
  };
}
