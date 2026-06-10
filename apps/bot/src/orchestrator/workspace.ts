import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import {
  parseRunnerEvent,
  serializeEvent,
  type HostMessage,
  type RunnerEvent,
  type TaskSpec,
} from "@anywherecode/shared";
import type { Config } from "../config.js";

export interface WorkspaceHandle {
  /** Opaque id for /cancel bookkeeping (container id for Docker). */
  id: string;
  events: AsyncIterable<RunnerEvent>;
  send(message: HostMessage): void;
  kill(): Promise<void>;
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
    const container = await this.docker.createContainer({
      Image: this.config.RUNNER_IMAGE,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
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
    stderr.resume(); // drain; runner debug output goes to the bot's logs only
    await container.start();
    stream.write(serializeEvent(spec));

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
    };
  }
}
