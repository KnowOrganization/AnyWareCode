import { z } from "zod";

/**
 * The NDJSON protocol between the bot (host) and the runner (container).
 *
 * Host -> runner (container stdin):
 *   line 1: TaskSpec
 *   then:   HostMessage per line
 *
 * Runner -> host (container stdout):
 *   RunnerEvent per line. Anything that doesn't parse as JSON is treated as
 *   runner debug output and ignored by the host.
 */

export const transcriptEntrySchema = z.object({
  author: z.string(),
  text: z.string(),
});
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const llmAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("anthropic_api_key"), token: z.string().min(1) }),
  z.object({ type: z.literal("claude_oauth"), token: z.string().min(1) }),
  z.object({
    type: z.literal("custom"),
    token: z.string().min(1),
    baseUrl: z.string().url(),
    model: z.string().min(1),
  }),
]);
export type LlmAuth = z.infer<typeof llmAuthSchema>;

export const taskSpecSchema = z.object({
  taskId: z.string(),
  /** "owner/name" */
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  /** Branch the runner creates (code mode) or checks out (iterate). */
  branch: z.string(),
  /** Branch to fork from / open the PR against. */
  baseBranch: z.string(),
  prompt: z.string(),
  mode: z.enum(["code", "ask", "plan"]),
  /**
   * Per-task model override (e.g. "claude-opus-4-8"). Empty = the runner's
   * DEFAULT_MODEL. Ignored for `custom` providers, whose own model wins.
   */
  model: z.string().min(1).optional(),
  /** Which agent engine the runner spawns. Default = the Claude Agent SDK. */
  engine: z.enum(["claude", "claw"]).default("claude"),
  /**
   * Verification + self-repair config. Absent = runner auto-detects checks with
   * no repair. `maxRepairAttempts` is tier-gated by the bot (0 = report only).
   */
  verify: z
    .object({
      enabled: z.boolean().default(true),
      maxRepairAttempts: z.number().int().min(0).max(5).default(0),
      /** Optional explicit command override (still allowlist-validated by the runner). */
      commands: z
        .array(
          z.object({
            name: z.string().regex(/^[a-z0-9-]+$/),
            run: z.string().max(200),
          }),
        )
        .max(6)
        .optional(),
    })
    .optional(),
  /** Prior context (e.g. PR review comments when iterating). */
  transcript: z.array(transcriptEntrySchema).default([]),
  /** True when `branch` already exists on the remote (Iterate flow). */
  resumeBranch: z.boolean().default(false),
  /**
   * Secrets travel here (stdin), never as container env vars: env is visible in
   * `docker inspect` and is inherited by every child the agent spawns. The
   * runner reads this, uses the GitHub token only for its own git calls, and
   * sets exactly one credential env set just before invoking the SDK.
   */
  githubToken: z.string().min(1),
  llmAuth: llmAuthSchema,
  /**
   * Server Memory: TRUSTED per-repo conventions doc, written by the server's
   * maintainers (never repo content). Injected as a system-prompt section.
   */
  memory: z.string().max(8192).optional(),
  /**
   * Per-server MCP extensions (remote servers only). Auth rides the headers —
   * stdin like every other secret; the runner registers each value for
   * redaction before any error path can echo it.
   */
  mcpServers: z
    .array(
      z.object({
        /** Tool namespace: tools surface as mcp__<name>__<tool>. */
        name: z.string().regex(/^[a-z0-9-]+$/),
        type: z.enum(["http", "sse"]),
        url: z.string().url(),
        headers: z.record(z.string()).optional(),
      }),
    )
    .default([]),
  /** Provenance commit trailers appended to the agent's commit message. */
  provenance: z
    .object({ trailers: z.array(z.string().max(200)).max(6) })
    .optional(),
});
export type TaskSpec = z.infer<typeof taskSpecSchema>;

export const hostMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_message"),
    author: z.string(),
    text: z.string(),
  }),
  /** Runtime control plane (streaming-input mode only). */
  z.object({ type: z.literal("set_model"), model: z.string() }),
  z.object({ type: z.literal("set_mode"), mode: z.enum(["code", "ask", "plan"]) }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("cancel") }),
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;

export const runnerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan"), text: z.string() }),
  z.object({ type: z.literal("read_files"), files: z.array(z.string()) }),
  z.object({ type: z.literal("edit_file"), file: z.string() }),
  z.object({ type: z.literal("bash"), command: z.string() }),
  z.object({
    type: z.literal("tests"),
    passed: z.boolean(),
    summary: z.string(),
  }),
  /** Generic verification result (typecheck/test/lint/build/verify). */
  z.object({
    type: z.literal("check"),
    name: z.string(),
    passed: z.boolean(),
    summary: z.string(),
  }),
  /** Plan-mode output: a proposed plan the host turns into approve buttons. */
  z.object({ type: z.literal("plan_proposed"), text: z.string() }),
  /** Echo of a runtime model switch. */
  z.object({ type: z.literal("model_changed"), model: z.string() }),
  z.object({ type: z.literal("assistant_text"), text: z.string() }),
  z.object({ type: z.literal("pushed"), branch: z.string() }),
  /** Per-file change stats, emitted after a successful push. */
  z.object({
    type: z.literal("diff_summary"),
    files: z.array(
      z.object({
        path: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    ),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({
    type: z.literal("done"),
    summary: z.string().optional(),
  }),
]);
export type RunnerEvent = z.infer<typeof runnerEventSchema>;

/** Parse one NDJSON line into a RunnerEvent, or null for non-protocol output. */
export function parseRunnerEvent(line: string): RunnerEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = runnerEventSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function serializeEvent(
  event: RunnerEvent | HostMessage | TaskSpec,
): string {
  return JSON.stringify(event) + "\n";
}

/** Branch namespace the runner is allowed to push to. */
export function taskBranchName(taskId: string): string {
  return `anywarecode/${taskId}`;
}
