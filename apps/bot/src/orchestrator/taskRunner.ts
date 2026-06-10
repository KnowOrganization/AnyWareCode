import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ThreadChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import {
  taskBranchName,
  type TaskSpec,
  type TranscriptEntry,
} from "@anywherecode/shared";
import type { Config } from "../config.js";
import { schema, type Db } from "../db/index.js";
import type { GitHubService } from "../github/app.js";
import { GuildTaskLimiter } from "./limiter.js";
import { ProgressRenderer, ThrottledUpdater } from "./renderer.js";
import type { Workspace, WorkspaceHandle } from "./workspace.js";

export interface StartTaskParams {
  guildId: string;
  installationId: number;
  channelId: string;
  thread: ThreadChannel;
  repoFullName: string;
  prompt: string;
  requestedBy: string;
  mode: "code" | "ask";
  /** Iterate flow: continue an existing branch/PR instead of opening a new one. */
  iterate?: {
    branch: string;
    prNumber: number;
    transcript: TranscriptEntry[];
  };
}

type TerminalReason = "cancel" | "timeout";

interface ActiveTask {
  taskId: string;
  guildId: string;
  mode: "code" | "ask";
  /** Null until the container starts (e.g. while queued behind another task). */
  handle: WorkspaceHandle | null;
  /** Set when the task is being stopped, so the run loop reports it correctly. */
  terminalReason: TerminalReason | null;
}

export class TaskOrchestrator {
  private limiter = new GuildTaskLimiter(1);
  /** threadId -> running task, used for reply forwarding and /cancel. */
  private active = new Map<string, ActiveTask>();

  constructor(
    private db: Db,
    private github: GitHubService,
    private workspace: Workspace,
    private config: Config,
  ) {}

  activeByThread(threadId: string): ActiveTask | undefined {
    return this.active.get(threadId);
  }

  activeForGuild(guildId: string): ActiveTask[] {
    return [...this.active.values()].filter((t) => t.guildId === guildId);
  }

  forwardThreadMessage(threadId: string, author: string, text: string): void {
    this.active
      .get(threadId)
      ?.handle?.send({ type: "user_message", author, text });
  }

  async cancel(threadId: string): Promise<boolean> {
    const task = this.active.get(threadId);
    if (!task || task.terminalReason) return false;
    task.terminalReason = "cancel";
    // Works whether the task is running (kill the container) or still queued
    // (handle is null; the run loop bails out before starting one).
    task.handle?.send({ type: "cancel" });
    await task.handle?.kill();
    return true;
  }

  /** Runs a task to completion. Returns when the task is finished. */
  async run(params: StartTaskParams): Promise<void> {
    const taskId = randomUUID().slice(0, 8);
    const branch = params.iterate?.branch ?? taskBranchName(taskId);
    const baseBranch = await this.github.defaultBranch(
      params.installationId,
      params.repoFullName,
    );

    await this.db.insert(schema.tasks).values({
      id: taskId,
      guildId: params.guildId,
      channelId: params.channelId,
      threadId: params.thread.id,
      repoFullName: params.repoFullName,
      branch,
      baseBranch,
      mode: params.mode,
      prompt: params.prompt,
      requestedBy: params.requestedBy,
    });

    // Registered before acquiring a slot so /cancel works even while queued.
    const task: ActiveTask = {
      taskId,
      guildId: params.guildId,
      mode: params.mode,
      handle: null,
      terminalReason: null,
    };
    this.active.set(params.thread.id, task);

    const slot = await this.limiter.acquire(params.guildId);
    if (slot.queued) {
      await params.thread.send("⏳ Queued behind another task in this server…");
    }

    try {
      if (task.terminalReason === "cancel") {
        // Cancelled before it ever ran.
        await this.settle(task, "cancelled");
        await params.thread.send("🛑 Task cancelled before it started.");
        return;
      }
      await this.execute(task, branch, baseBranch, params);
    } finally {
      this.limiter.release(params.guildId);
      this.active.delete(params.thread.id);
    }
  }

  private async execute(
    task: ActiveTask,
    branch: string,
    baseBranch: string,
    params: StartTaskParams,
  ): Promise<void> {
    const { thread } = params;
    const { taskId } = task;
    const token = await this.github.mintRepoToken(
      params.installationId,
      params.repoFullName,
    );
    const spec: TaskSpec = {
      taskId,
      repo: params.repoFullName,
      branch,
      baseBranch,
      prompt: params.prompt,
      mode: params.mode,
      transcript: params.iterate?.transcript ?? [],
      resumeBranch: Boolean(params.iterate),
      // Secrets ride the (stdin) spec, never container env vars.
      githubToken: token,
      anthropicApiKey: this.config.ANTHROPIC_API_KEY,
    };

    // Only non-secret config goes in the container environment.
    const env: Record<string, string> = {};
    if (this.config.RUNNER_HTTPS_PROXY) {
      env.HTTPS_PROXY = this.config.RUNNER_HTTPS_PROXY;
      env.HTTP_PROXY = this.config.RUNNER_HTTPS_PROXY;
    }

    const handle = await this.workspace.start(spec, env);
    task.handle = handle;
    // A /cancel that landed between slot acquisition and here.
    if (this.reasonOf(task) === "cancel") {
      await handle.kill();
      await this.settle(task, "cancelled");
      await thread.send("🛑 Task cancelled.");
      return;
    }
    await this.db
      .update(schema.tasks)
      .set({ status: "running", containerId: handle.id })
      .where(eq(schema.tasks.id, taskId));

    const timeout = setTimeout(
      () => {
        task.terminalReason = "timeout";
        void handle.kill();
      },
      this.config.TASK_TIMEOUT_MINUTES * 60 * 1000,
    );

    const progressMessage = await thread.send({
      embeds: [progressEmbed("🧠 Starting…")],
    });
    const renderer = new ProgressRenderer();
    const updater = new ThrottledUpdater(async () => {
      await progressMessage.edit({ embeds: [progressEmbed(renderer.render())] });
    });

    let pushed = false;
    let errorMessage: string | null = null;
    let summary: string | undefined;

    try {
      for await (const event of handle.events) {
        if (event.type === "assistant_text") {
          for (const chunk of chunkText(event.text, 2000)) {
            await thread.send(chunk);
          }
          continue;
        }
        if (event.type === "pushed") pushed = true;
        if (event.type === "error") errorMessage = event.message;
        if (event.type === "done") summary = event.summary;
        if (renderer.add(event)) updater.schedule();
      }
    } finally {
      clearTimeout(timeout);
      await updater.flush();
    }

    // A stop (cancel/timeout) takes precedence over whatever the truncated
    // event stream looked like — otherwise a killed task reads as "done".
    const stopped = this.reasonOf(task);
    if (stopped === "cancel") {
      await this.settle(task, "cancelled");
      await thread.send("🛑 Task cancelled.");
      return;
    }
    if (stopped === "timeout") {
      await this.settle(task, "failed");
      await thread.send(
        "⏱️ Task hit the time limit and was stopped. Nothing was pushed.",
      );
      return;
    }

    if (errorMessage) {
      await this.settle(task, "failed");
      await thread.send(`⚠️ Task failed: ${truncateForDiscord(errorMessage)}`);
      return;
    }

    if (params.mode === "ask") {
      await this.settle(task, "done");
      return;
    }

    if (!pushed) {
      await this.settle(task, "done");
      await thread.send(
        summary
          ? `ℹ️ No changes were pushed. ${truncateForDiscord(summary)}`
          : "ℹ️ The agent finished without making changes.",
      );
      return;
    }

    let prNumber: number;
    let prUrl: string;
    if (params.iterate) {
      prNumber = params.iterate.prNumber;
      prUrl = `https://github.com/${params.repoFullName}/pull/${prNumber}`;
    } else {
      const pr = await this.github.createPullRequest({
        installationId: params.installationId,
        repoFullName: params.repoFullName,
        branch,
        baseBranch,
        title: params.prompt.split("\n")[0]?.slice(0, 72) ?? branch,
        body: `${params.prompt}\n\n---\nOpened by AnywhereCode from a Discord session.`,
      });
      prNumber = pr.number;
      prUrl = pr.url;
    }

    await this.db
      .update(schema.tasks)
      .set({ status: "done", prNumber, finishedAt: new Date() })
      .where(eq(schema.tasks.id, taskId));

    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`🔀 PR #${prNumber} ready`)
          .setURL(prUrl)
          .setDescription(truncateForDiscord(summary ?? params.prompt)),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`aw:merge:${taskId}`)
            .setLabel("Merge")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`aw:iterate:${taskId}`)
            .setLabel("Iterate")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel("View on GitHub")
            .setStyle(ButtonStyle.Link)
            .setURL(prUrl),
        ),
      ],
    });
  }

  /**
   * Reads the stop reason through a call so TypeScript doesn't narrow it away:
   * the field is mutated asynchronously (by /cancel and the timeout timer),
   * which control-flow analysis can't see.
   */
  private reasonOf(task: ActiveTask): TerminalReason | null {
    return task.terminalReason;
  }

  private async settle(
    task: ActiveTask,
    status: "done" | "failed" | "cancelled",
  ): Promise<void> {
    await this.db
      .update(schema.tasks)
      .set({ status, finishedAt: new Date() })
      .where(eq(schema.tasks.id, task.taskId));
    // A task that didn't actually do useful work shouldn't burn the monthly
    // quota that was reserved when it was launched.
    if (status !== "done") await this.refundUsage(task.guildId, task.mode);
  }

  private async refundUsage(
    guildId: string,
    mode: "code" | "ask",
  ): Promise<void> {
    const guild = await this.db.query.guilds.findFirst({
      where: eq(schema.guilds.id, guildId),
    });
    if (!guild) return;
    await this.db
      .update(schema.guilds)
      .set(
        mode === "code"
          ? { tasksUsedThisMonth: Math.max(0, guild.tasksUsedThisMonth - 1) }
          : { asksUsedThisMonth: Math.max(0, guild.asksUsedThisMonth - 1) },
      )
      .where(eq(schema.guilds.id, guildId));
  }
}

function progressEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0x5865f2).setDescription(description);
}

export function chunkText(text: string, max: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks;
}

function truncateForDiscord(text: string): string {
  return text.length > 1800 ? `${text.slice(0, 1800)}…` : text;
}
