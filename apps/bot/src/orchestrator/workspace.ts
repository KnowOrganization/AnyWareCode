import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import {
  parseRunnerEvent,
  serializeEvent,
  type HostMessage,
  type RunnerEvent,
  type TaskSpec,
} from "@anywarecode/shared";
import type { Config } from "../config.js";
import { log } from "../observability.js";

export interface WorkspaceHandle {
  /** Opaque id for /cancel bookkeeping (container id for Docker). */
  id: string;
  events: AsyncIterable<RunnerEvent>;
  send(message: HostMessage): void;
  kill(): Promise<void>;
  /** Container exit detail, available after the event stream closes. Optional so
   *  non-Docker backends need not implement it. */
  exitInfo?(): { exitCode: number | null; oomKilled: boolean };
  /** Retained tail (~4 KB) of the runner's stderr — diagnostic for silent exits. */
  lastStderr?(): string;
}

/**
 * Execution backend boundary. v1 is local Docker; a Fly Machines /
 * Firecracker backend implements the same interface later.
 */
export interface Workspace {
  start(spec: TaskSpec, env: Record<string, string>): Promise<WorkspaceHandle>;
}

export class DockerWorkspace implements Workspace {
  private docker: Docker;

  constructor(private config: Config) {
    this.docker = new Docker();
  }

  async start(
    spec: TaskSpec,
    env: Record<string, string>,
  ): Promise<WorkspaceHandle> {
    try {
      await this.docker.ping();
    } catch {
      throw new Error(
        "Docker daemon not reachable — is Docker Desktop running?",
      );
    }
    const images = await this.docker.listImages({
      filters: JSON.stringify({ reference: [this.config.RUNNER_IMAGE] }),
    });
    if (images.length === 0) {
      throw new Error(
        `Runner image "${this.config.RUNNER_IMAGE}" not found — rebuild with: docker compose up -d --build`,
      );
    }
    const container = await this.docker.createContainer({
      Image: this.config.RUNNER_IMAGE,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      Labels: { "anywarecode.task": spec.taskId },
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        AutoRemove: true,
        Memory: 2 * 1024 * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        PidsLimit: 512,
        CapDrop: ["ALL"],
        ...(this.config.RUNNER_NETWORK
          ? { NetworkMode: this.config.RUNNER_NETWORK }
          : {}),
      },
    });

    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    container.modem.demuxStream(stream, stdout, stderr);

    // Capture runner stderr (debug + crash output) instead of discarding it. Each
    // line is logged and a bounded tail is retained so a silent container death
    // (no "done"/"error" event) is still diagnosable from the failure path.
    let stderrTail = "";
    const STDERR_TAIL_MAX = 4096;
    const stderrRl = createInterface({ input: stderr, crlfDelay: Infinity });
    stderrRl.on("line", (line) => {
      if (!line) return;
      log.warn({ taskId: spec.taskId, src: "runner-stderr" }, line);
      stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL_MAX);
    });

    // Container exit detail, captured before AutoRemove destroys the container so
    // the bot can report *why* a silent exit happened (non-zero code, OOM).
    let exitCode: number | null = null;
    let oomKilled = false;
    const captureExit = (info: Docker.ContainerInspectInfo): void => {
      if (typeof info.State.ExitCode === "number") exitCode = info.State.ExitCode;
      if (info.State.OOMKilled) oomKilled = true;
    };

    // demuxStream never propagates end-of-stream. We poll container state to
    // reliably detect exit. Both container.wait() and the attach stream's
    // close/end/error events drop prematurely in production (Docker socket
    // resets while the container is still running), so we cannot trust any
    // single signal — we must verify via inspect() before ending stdout.
    const finish = (): void => {
      stdout.end();
      stderr.end();
    };
    const waitUntilExit = async (): Promise<void> => {
      for (;;) {
        try {
          const res = await container.wait();
          if (res && typeof res.StatusCode === "number") exitCode = res.StatusCode;
          // Best-effort richer detail (OOM flag) before AutoRemove fires.
          try {
            captureExit(await container.inspect());
          } catch {
            /* container already gone */
          }
          return; // clean exit
        } catch {
          // wait() connection dropped; check whether the container is still running.
        }
        try {
          const info = await container.inspect();
          if (!info.State.Running) {
            captureExit(info);
            return; // stopped (AutoRemove may not have fired yet)
          }
          // Still running — brief pause before retrying wait().
          await new Promise<void>((r) => setTimeout(r, 2000));
        } catch {
          return; // inspect() failed → container gone (AutoRemove destroyed it)
        }
      }
    };

    await container.start();
    stream.write(serializeEvent(spec));
    // Start exit-watching only AFTER the container is running. Calling
    // container.wait() on a not-yet-started container can resolve or error
    // immediately, firing finish() before any output flows — a false
    // "stopped unexpectedly" with an empty event stream.
    void waitUntilExit().then(finish);

    async function* events(): AsyncGenerator<RunnerEvent> {
      const rl = createInterface({ input: stdout, crlfDelay: Infinity });
      for await (const line of rl) {
        const event = parseRunnerEvent(line);
        if (event) yield event;
      }
    }

    return {
      id: container.id,
      events: events(),
      send: (message) => {
        stream.write(serializeEvent(message));
      },
      kill: async () => {
        await container.kill().catch(() => {});
      },
      exitInfo: () => ({ exitCode, oomKilled }),
      lastStderr: () => stderrTail,
    };
  }
}
