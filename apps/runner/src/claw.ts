import { spawn, type ChildProcess } from "node:child_process";
import type { RunnerEvent, TaskSpec } from "@anywarecode/shared";
import { buildSystemAppend, type Agent } from "./agent.js";
import { AsyncQueue, redactSecrets } from "./io.js";

/**
 * Alternate engine: the claw-code Rust CLI (ultraworkers/claw-code), behind the
 * same `Agent` seam as ClaudeAgent. EXPERIMENTAL and opt-in via spec.engine ===
 * "claw" (RUNNER_ENGINE on the bot); the binary must be baked into the image.
 *
 * Multi-provider — claw's headline — is already covered by the `custom` llmAuth
 * branch, and this engine gets none of the SDK features the rest of the runner
 * relies on (subagents, hooks, the control plane), so it's a fallback, not a
 * replacement. Output mapping is best-effort: claw's lines surface as assistant
 * text; the runner still owns git, so claw is never asked to push.
 */
export class ClawAgent implements Agent {
  private child: ChildProcess | null = null;
  private cancelled = false;

  // claw has no streaming-input control plane; these are best-effort no-ops.
  pushUserMessage(): void {}
  setModel(): void {}
  setPermissionMode(): void {}

  interrupt(): void {
    this.child?.kill("SIGINT");
  }

  cancel(): void {
    this.cancelled = true;
    this.child?.kill("SIGKILL");
  }

  async *run(spec: TaskSpec, workdir: string): AsyncIterable<RunnerEvent> {
    const queue = new AsyncQueue<RunnerEvent>();
    const bin = process.env.CLAW_BIN || "claw";
    // claw has no system-prompt API we can rely on, so embed the hardening +
    // conventions (buildSystemAppend) directly into the prompt. This guarantees
    // the prompt-injection defense reaches the model regardless of claw's flags.
    const system = buildSystemAppend(spec, workdir);
    const prompt = `${system}\n\n# Task\n${spec.prompt}`;
    const args = ["prompt"];
    // If a claw build exposes a system-prompt flag, also pass it natively.
    if (process.env.CLAW_SYSTEM_FLAG) args.push(process.env.CLAW_SYSTEM_FLAG, system);
    args.push(prompt);
    const child = spawn(bin, args, {
      cwd: workdir,
      env: process.env,
    });
    this.child = child;

    let outBuf = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      outBuf += d.toString();
      let nl: number;
      while ((nl = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, nl);
        outBuf = outBuf.slice(nl + 1);
        if (line.trim()) {
          queue.push({ type: "assistant_text", text: redactSecrets(line) });
        }
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err: Error) => {
      queue.push({
        type: "error",
        message: redactSecrets(`claw failed to start: ${err.message}`),
      });
      queue.push({ type: "done" });
      queue.end();
    });
    child.on("close", (code: number | null) => {
      if (outBuf.trim()) {
        queue.push({ type: "assistant_text", text: redactSecrets(outBuf) });
      }
      if (code !== 0 && !this.cancelled) {
        queue.push({
          type: "error",
          message: redactSecrets(`claw exited ${code}: ${stderr.slice(-500)}`),
        });
      }
      queue.push({ type: "done" });
      queue.end();
    });

    for await (const event of queue) yield event;
  }
}
