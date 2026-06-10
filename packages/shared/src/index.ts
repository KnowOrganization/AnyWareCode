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

export const taskSpecSchema = z.object({
  taskId: z.string(),
  /** "owner/name" */
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  /** Branch the runner creates (code mode) or checks out (iterate). */
  branch: z.string(),
  /** Branch to fork from / open the PR against. */
  baseBranch: z.string(),
  prompt: z.string(),
  mode: z.enum(["code", "ask"]),
  /** Prior context (e.g. PR review comments when iterating). */
  transcript: z.array(transcriptEntrySchema).default([]),
  /** True when `branch` already exists on the remote (Iterate flow). */
  resumeBranch: z.boolean().default(false),
  /**
   * Secrets travel here (stdin), never as container env vars: env is visible in
   * `docker inspect` and is inherited by every child the agent spawns. The
   * runner reads these, uses the GitHub token only for its own git calls, and
   * sets ANTHROPIC_API_KEY just before invoking the SDK.
   */
  githubToken: z.string().min(1),
  anthropicApiKey: z.string().min(1),
});
export type TaskSpec = z.infer<typeof taskSpecSchema>;

export const hostMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_message"),
    author: z.string(),
    text: z.string(),
  }),
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
  z.object({ type: z.literal("assistant_text"), text: z.string() }),
  z.object({ type: z.literal("pushed"), branch: z.string() }),
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
  return `anywherecode/${taskId}`;
}
