import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ThreadChannel,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import {
  taskBranchName,
  type TaskSpec,
  type TranscriptEntry,
} from "@anywarecode/shared";
import type { Config } from "../config.js";
import { schema, type Db } from "@anywarecode/db";
import { planHasFeature } from "../discord/gates.js";
import { mcpServersForSpec } from "../discord/mcp.js";
import { maybeSuggestMemory } from "../discord/memorySuggestions.js";
import { prCardButtons } from "../discord/preview-card.js";
import type { GitHubService } from "../github/app.js";
import { getUserLink } from "../github/user-link.js";
import { isAuthError, resolveLlmAuth } from "../llm/credentials.js";
import { captureError, log } from "../observability.js";
import { GuildTaskLimiter } from "./limiter.js";
import { ProgressRenderer, ThrottledUpdater } from "./renderer.js";
import { refundUsage, type FundedBy } from "./usage.js";
import type { Workspace, WorkspaceHandle } from "./workspace.js";

export interface StartTaskParams {
  /** Caller-supplied id (squads pre-generate ids to link attempts in DB). */
  taskId?: string;
  /** Squad attempts: push the branch but defer PR creation to the vote. */
  deferPr?: boolean;
  guildId: string;
  installationId: number;
  channelId: string;
  thread: ThreadChannel;
  repoFullName: string;
  prompt: string;
  requestedBy: string;
  /** Sponsor's Discord user id (provenance: GitHub identity lookup). */
  requestedById?: string;
  /** Provenance: who approved the plan vote (omitted = instant mode). */
  planApprovedBy?: string;
  mode: "code" | "ask";
  /** Per-task model override (paid tiers; ignored for custom providers). */
  model?: string;
  /** Plan-first: run the agent in plan mode, post the plan for approval. */
  planMode?: boolean;
  /** Quota bucket launchTask consumed for this task; refunds reverse it. */
  fundedBy?: FundedBy;
  /** Iterate flow: continue an existing branch/PR instead of opening a new one. */
  iterate?: {
    branch: string;
    prNumber: number;
    transcript: TranscriptEntry[];
  };
  /** Extra context injected as prior conversation (e.g. a PR diff for review). */
  transcript?: TranscriptEntry[];
  /** Ask mode only: clone this ref instead of the default branch (PR review). */
  checkoutRef?: string;
  /** Ask mode only: also post the final summary as an embed to this channel. */
  summaryTarget?: { channelId: string; title: string };
}

type TerminalReason = "cancel" | "timeout";

/** What a finished run produced — awaited by Repro Gate and Squad Mode. */
export interface RunOutcome {
  taskId: string;
  status: "done" | "failed" | "cancelled";
  pushed: boolean;
  branch: string;
  prNumber: number | null;
  summary?: string;
  diffFiles: Array<{ path: string; additions: number; deletions: number }>;
  /** False when verification checks were still failing at push time. */
  verified?: boolean;
  /** Names of checks still failing at push time (empty/omitted when verified). */
  failingChecks?: string[];
}

interface ActiveTask {
  taskId: string;
  guildId: string;
  mode: "code" | "ask";
  fundedBy: FundedBy;
  /** Forwarded thread replies — fuel for post-task memory suggestions. */
  corrections: Array<{ author: string; text: string }>;
  /** Live progress renderer; the Spectate button flips it verbose. */
  renderer: ProgressRenderer | null;
  /** Null until the container starts (e.g. while queued behind another task). */
  handle: WorkspaceHandle | null;
  /** Set when the task is being stopped, so the run loop reports it correctly. */
  terminalReason: TerminalReason | null;
  /** "guild" once the BYO LLM credential resolves; null before resolution. */
  llmSource: "guild" | null;
  /** Whether this guild's plan permits model selection (gates mid-run !model). */
  modelSelectAllowed: boolean;
  /** False for plan-mode runs (free) so a failure never refunds a non-charge. */
  charged: boolean;
}

/** A plan-mode result awaiting an Implement click (in-memory, like active tasks). */
export interface PendingPlan {
  guildId: string;
  installationId: number;
  channelId: string;
  threadId: string;
  repoFullName: string;
  prompt: string;
  requestedBy: string;
  requestedById: string | null;
  model: string | null;
  planText: string;
  /** Epoch ms when proposed; used to expire stale plans (PLAN_VOTE_TTL_MINUTES). */
  createdAt: number;
}

export class TaskOrchestrator {
  private limiter = new GuildTaskLimiter();
  /** threadId -> running task, used for reply forwarding and /cancel. */
  private active = new Map<string, ActiveTask>();
  /** taskId -> proposed plan awaiting an Implement click. */
  private pendingPlans = new Map<string, PendingPlan>();

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
    const task = this.active.get(threadId);
    if (!task) return;
    // Runtime control commands steer the live agent instead of adding a turn.
    const model = /^!model\s+(\S+)/.exec(text.trim());
    if (model?.[1]) {
      // Gate mid-run escalation by the same rules as the /code picker.
      const requested = model[1];
      const allowed =
        task.modelSelectAllowed &&
        (this.config.modelAllowlist.length === 0 ||
          this.config.modelAllowlist.includes(requested));
      if (allowed) task.handle?.send({ type: "set_model", model: requested });
      else
        task.handle?.send({
          type: "user_message",
          author: "system",
          text: `(Ignored "!model ${requested}": model selection needs a Pro/Studio plan or an allowed model.)`,
        });
      return;
    }
    const modeCmd = /^!mode\s+(code|ask|plan)\b/.exec(text.trim());
    if (modeCmd?.[1]) {
      task.handle?.send({
        type: "set_mode",
        mode: modeCmd[1] as "code" | "ask" | "plan",
      });
      return;
    }
    task.corrections.push({ author, text });
    task.handle?.send({ type: "user_message", author, text });
  }

  async cancel(threadId: string): Promise<boolean> {
    const task = this.active.get(threadId);
    if (!task || task.terminalReason) return false;
    task.terminalReason = "cancel";
    task.handle?.send({ type: "cancel" });
    await task.handle?.kill();
    return true;
  }

  /** Runs a task to completion; resolves with what the run produced. */
  async run(params: StartTaskParams): Promise<RunOutcome> {
    if (params.deferPr && params.iterate) {
      throw new Error("deferPr and iterate are mutually exclusive");
    }
    const taskId = params.taskId ?? randomUUID().slice(0, 8);
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
      installationId: params.installationId,
      branch,
      baseBranch,
      mode: params.mode,
      prompt: params.prompt,
      requestedBy: params.requestedBy,
      fundedBy: params.fundedBy ?? "plan",
      planApprovedBy: params.planApprovedBy ?? null,
    });

    // Registered before acquiring a slot so /cancel works even while queued.
    const task: ActiveTask = {
      taskId,
      guildId: params.guildId,
      mode: params.mode,
      fundedBy: params.fundedBy ?? "plan",
      corrections: [],
      renderer: null,
      handle: null,
      terminalReason: null,
      llmSource: null,
      modelSelectAllowed: false,
      charged: !params.planMode,
    };
    this.active.set(params.thread.id, task);

    const guildRow = await this.db.query.guilds.findFirst({
      where: eq(schema.guilds.id, params.guildId),
    });
    const limit = guildRow?.concurrency ?? 1;
    if (this.limiter.runningCount(params.guildId) >= limit) {
      await params.thread.send(
        `⏳ Queued — ${this.limiter.runningCount(params.guildId)}/${limit} task slots in use…`,
      );
    }
    await this.limiter.acquire(params.guildId, limit);

    try {
      if (task.terminalReason === "cancel") {
        await this.settle(task, "cancelled");
        await params.thread.send("🛑 Task cancelled before it started.");
        return {
          taskId,
          status: "cancelled",
          pushed: false,
          branch,
          prNumber: null,
          diffFiles: [],
        };
      }
      return await this.execute(task, branch, baseBranch, params);
    } catch (err) {
      // An unexpected throw (GitHub/Discord/DB) must still settle the task —
      // otherwise the row is stuck "running" and quota isn't refunded until the
      // next boot's recovery sweep. Idempotent with that sweep.
      captureError(err, { msg: "task execute crashed", taskId });
      if (!task.terminalReason) {
        await this.settle(task, "failed").catch(() => {});
        await params.thread
          .send("⚠️ The task failed unexpectedly. Nothing was pushed.")
          .catch(() => {});
      }
      return {
        taskId,
        status: "failed",
        pushed: false,
        branch,
        prNumber: null,
        diffFiles: [],
      };
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
  ): Promise<RunOutcome> {
    const { thread } = params;
    const { taskId } = task;
    const out = (
      status: RunOutcome["status"],
      extra: Partial<RunOutcome> = {},
    ): RunOutcome => ({
      taskId,
      status,
      pushed: false,
      branch,
      prNumber: null,
      diffFiles: [],
      ...extra,
    });

    // Resolve LLM auth before spending GitHub token quota.
    const resolved = await resolveLlmAuth(this.db, this.config, params.guildId);
    if (!resolved.auth) {
      await this.settle(task, "failed");
      await thread.send(`⚠️ ${resolved.reason}`);
      return out("failed");
    }
    task.llmSource = resolved.source;

    // One guild fetch for both feature checks (model_select + verify_loop).
    const guildRow = await this.db.query.guilds.findFirst({
      where: eq(schema.guilds.id, params.guildId),
    });
    const planId = guildRow?.planId ?? null;
    task.modelSelectAllowed = await planHasFeature(
      this.db,
      planId,
      "model_select",
    );

    // Verification + self-repair runs on every plan (BYO key) — code mode only,
    // never plan mode. Master switch is VERIFY_ENABLED.
    const verifyOn =
      this.config.VERIFY_ENABLED && params.mode === "code" && !params.planMode;
    const maxRepairAttempts = verifyOn
      ? this.config.VERIFY_MAX_REPAIR_ATTEMPTS
      : 0;

    const timeoutMinutes = this.config.TASK_TIMEOUT_MINUTES;

    // Ask mode is read-only by contract — its token can't push (defense in
    // depth for runs that execute untrusted content, e.g. Repro Gate).
    // Plan mode never pushes, so it gets a read-only token like ask mode.
    const canPush = params.mode === "code" && !params.planMode;
    const token = await this.github.mintRepoToken(
      params.installationId,
      params.repoFullName,
      canPush,
    );
    // Server Memory: trusted per-repo conventions, injected into every run.
    const memoryRow = await this.db.query.serverMemories.findFirst({
      where: and(
        eq(schema.serverMemories.guildId, params.guildId),
        eq(schema.serverMemories.repoFullName, params.repoFullName),
      ),
    });
    // Server-attached MCP extensions (auth decrypted only here, into stdin).
    const mcp = await mcpServersForSpec(this.db, this.config, params.guildId);
    // Provenance: the receipt's identity line + commit trailers.
    const sponsorLink = params.requestedById
      ? await getUserLink(this.db, params.requestedById)
      : null;
    const initiatedBy = `discord:${params.requestedBy}${
      sponsorLink ? ` (github:${sponsorLink.githubLogin})` : ""
    }`;
    const threadUrl = `https://discord.com/channels/${params.guildId}/${thread.id}`;
    const trailers = [
      `Initiated-by: ${initiatedBy}`,
      `Task-thread: ${threadUrl}`,
      "Sponsored-via: AnyWareCode",
    ];
    const spec: TaskSpec = {
      taskId,
      repo: params.repoFullName,
      branch,
      // Ask mode can review any ref (e.g. a PR head): the runner clones
      // baseBranch and ask mode never pushes, so overriding it is safe.
      baseBranch:
        params.mode === "ask" && params.checkoutRef
          ? params.checkoutRef
          : baseBranch,
      prompt: params.prompt,
      mode: params.planMode ? "plan" : params.mode,
      engine: this.config.RUNNER_ENGINE,
      transcript: params.transcript ?? params.iterate?.transcript ?? [],
      resumeBranch: Boolean(params.iterate),
      githubToken: token,
      llmAuth: resolved.auth,
      mcpServers: mcp.servers,
      ...(params.model ? { model: params.model } : {}),
      ...(verifyOn ? { verify: { enabled: true, maxRepairAttempts } } : {}),
      ...(memoryRow?.content.trim() ? { memory: memoryRow.content } : {}),
      ...(canPush ? { provenance: { trailers } } : {}),
    };
    for (const warning of mcp.warnings) {
      await thread.send(warning).catch(() => {});
    }

    // Only non-secret config goes in the container environment.
    const env: Record<string, string> = {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      MAX_AGENT_TURNS: String(this.config.MAX_AGENT_TURNS),
      TASK_TIMEOUT_MINUTES: String(timeoutMinutes),
    };
    // Repair-turn model escalation (paid tiers only — gated by maxRepairAttempts).
    if (maxRepairAttempts > 0 && this.config.VERIFY_REPAIR_MODEL) {
      env.VERIFY_REPAIR_MODEL = this.config.VERIFY_REPAIR_MODEL;
      env.VERIFY_ESCALATE_AFTER = String(this.config.VERIFY_ESCALATE_AFTER);
    }
    if (this.config.RUNNER_HTTPS_PROXY) {
      env.HTTPS_PROXY = this.config.RUNNER_HTTPS_PROXY;
      env.HTTP_PROXY = this.config.RUNNER_HTTPS_PROXY;
    }

    let handle: WorkspaceHandle;
    try {
      handle = await withTimeout(
        this.workspace.start(spec, env),
        WORKSPACE_START_TIMEOUT_MS,
        "workspace start timed out",
      );
    } catch (err) {
      captureError(err, { msg: "workspace start failed", taskId });
      await this.settle(task, "failed");
      await thread.send(
        "⚠️ Couldn't start the task container (the host may be busy). Try again shortly.",
      );
      return out("failed");
    }
    task.handle = handle;
    // A /cancel that landed between slot acquisition and here.
    if (this.reasonOf(task) === "cancel") {
      await handle.kill();
      await this.settle(task, "cancelled");
      await thread.send("🛑 Task cancelled.");
      return out("cancelled");
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
      timeoutMinutes * 60 * 1000,
    );

    const progressMessage = await thread.send({
      embeds: [progressEmbed("🧠 Starting…")],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`aw:spectate:${taskId}`)
            .setLabel("Spectate 👁")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    const renderer = new ProgressRenderer();
    task.renderer = renderer;
    const updater = new ThrottledUpdater(async () => {
      await progressMessage.edit({ embeds: [progressEmbed(renderer.render())] });
    });

    let pushed = false;
    let errorMessage: string | null = null;
    let summary: string | undefined;
    let planText: string | null = null;
    let diffFiles: Array<{ path: string; additions: number; deletions: number }> =
      [];
    const testResults: Array<{ passed: boolean; summary: string }> = [];
    // Final verification state: a check name is "failing" if its LAST result
    // failed (a repair turn that fixes it removes it from the set).
    const failingChecks = new Set<string>();
    let checksRan = false;

    try {
      for await (const event of handle.events) {
        if (event.type === "assistant_text") {
          for (const chunk of chunkText(event.text, 2000)) {
            await thread.send(chunk);
          }
          continue;
        }
        if (event.type === "pushed") pushed = true;
        if (event.type === "diff_summary") diffFiles = event.files;
        if (event.type === "tests") testResults.push(event);
        if (event.type === "check") {
          testResults.push({
            passed: event.passed,
            summary: `${event.name}: ${event.summary}`,
          });
          checksRan = true;
          if (event.passed) failingChecks.delete(event.name);
          else failingChecks.add(event.name);
        }
        if (event.type === "plan_proposed") planText = event.text;
        if (event.type === "error") errorMessage = event.message;
        if (event.type === "done") summary = event.summary;
        if (renderer.add(event)) updater.schedule();
      }
    } finally {
      clearTimeout(timeout);
      await updater.flush();
      // Run over — retire the Spectate button.
      await progressMessage.edit({ components: [] }).catch(() => {});
    }

    const stopped = this.reasonOf(task);
    if (stopped === "cancel") {
      await this.settle(task, "cancelled");
      await thread.send("🛑 Task cancelled.");
      return out("cancelled");
    }
    if (stopped === "timeout") {
      await this.settle(task, "failed");
      await thread.send(
        "⏱️ Task hit the time limit and was stopped. Nothing was pushed.",
      );
      return out("failed");
    }

    if (errorMessage) {
      await this.settle(task, "failed");
      if (isAuthError(errorMessage)) {
        await thread.send(
          "⚠️ LLM credential looks invalid or revoked. Admin: run `/connect llm` to reconnect.",
        );
      } else {
        await thread.send(
          `⚠️ Task failed: ${truncateForDiscord(errorMessage)}`,
        );
      }
      return out("failed");
    }

    // Plan mode: post the proposed plan with an approve button; the actual
    // code task launches only when someone clicks Implement.
    if (params.planMode) {
      await this.settle(task, "done");
      if (planText?.trim()) {
        this.sweepPendingPlans();
        this.pendingPlans.set(taskId, {
          guildId: params.guildId,
          installationId: params.installationId,
          channelId: params.channelId,
          threadId: thread.id,
          repoFullName: params.repoFullName,
          prompt: params.prompt,
          requestedBy: params.requestedBy,
          requestedById: params.requestedById ?? null,
          model: params.model ?? null,
          planText: planText.trim(),
          createdAt: Date.now(),
        });
        await thread.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("📋 Proposed plan")
              .setDescription(truncateForDiscord(planText.trim())),
          ],
          components: [planApprovalButtons(taskId)],
        });
      } else {
        await thread.send(
          summary
            ? `📋 ${truncateForDiscord(summary)}`
            : "ℹ️ The agent finished planning without producing a plan.",
        );
      }
      return out("done", { summary });
    }

    if (params.mode === "ask") {
      await this.settle(task, "done");
      // Review-style asks mirror their summary to a channel (never pings).
      if (params.summaryTarget && summary) {
        const channel = await thread.client.channels
          .fetch(params.summaryTarget.channelId)
          .catch(() => null);
        if (channel?.isSendable()) {
          await channel
            .send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5865f2)
                  .setTitle(params.summaryTarget.title.slice(0, 250))
                  .setDescription(summary.slice(0, 4000))
                  .setFooter({ text: `Details in the thread` }),
              ],
              allowedMentions: { parse: [] },
            })
            .catch((err) =>
              log.warn({ err }, "summary target post failed"),
            );
        }
      }
      return out("done", { summary, diffFiles });
    }

    // Squad attempt: the branch is the deliverable — the PR waits for the vote.
    if (params.deferPr) {
      if (!pushed) {
        // Nothing to vote on shouldn't consume a unit.
        await this.settle(task, "failed");
        await thread.send(
          "🏳️ This attempt produced no changes — its task unit was refunded.",
        );
        return out("failed", { summary });
      }
      await this.db
        .update(schema.tasks)
        .set({
          status: "done",
          diffSummary: diffFiles,
          finishedAt: new Date(),
        })
        .where(eq(schema.tasks.id, taskId));
      const add = diffFiles.reduce((n, f) => n + f.additions, 0);
      const del = diffFiles.reduce((n, f) => n + f.deletions, 0);
      await thread.send(
        `🏁 Attempt finished — \`${branch}\` (${diffFiles.length} file(s), +${add} −${del}). The squad vote decides whether it ships.`,
      );
      return out("done", { pushed: true, summary, diffFiles });
    }

    if (!pushed) {
      await this.settle(task, "done");
      await thread.send(
        summary
          ? `ℹ️ No changes were pushed. ${truncateForDiscord(summary)}`
          : "ℹ️ The agent finished without making changes.",
      );
      return out("done", { summary });
    }

    // Honest verification labeling: surface checks that were still failing when
    // the run ended (changes are pushed regardless — humans are the merge gate).
    const failing = [...failingChecks];
    const verified = !checksRan || failing.length === 0;
    const receipt = provenanceReceipt({
      initiatedBy,
      planApprovedBy: params.planApprovedBy ?? null,
      steeredBy: [...new Set(task.corrections.map((c) => c.author))],
      testResults,
      diffFiles,
      threadUrl,
    });
    const warningBlock = verified
      ? ""
      : `> ⚠️ Automated checks did not pass: ${failing.join(", ")}. Review before merge.\n\n`;
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
        body: `${warningBlock}${params.prompt}\n\n${receipt}`,
      });
      prNumber = pr.number;
      prUrl = pr.url;
    }

    const prCard = await thread.send({
      embeds: [
        new EmbedBuilder()
          .setColor(verified ? 0x57f287 : 0xfee75c)
          .setTitle(
            verified ? `🔀 PR #${prNumber} ready` : `🔀 PR #${prNumber} — checks failing, review`,
          )
          .setURL(prUrl)
          .setDescription(truncateForDiscord(summary ?? params.prompt)),
      ],
      components: [prCardButtons(taskId, prUrl, null)],
    });

    await this.db
      .update(schema.tasks)
      .set({
        status: "done",
        prNumber,
        prMessageId: prCard.id,
        finishedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId));

    if (diffFiles.length > 0) {
      await thread
        .send({ embeds: [whatChangedEmbed(diffFiles)] })
        .catch(() => {});
    }

    // Corrections happened mid-run → offer to save them as Server Memory.
    void maybeSuggestMemory(
      { db: this.db, config: this.config },
      {
        guildId: params.guildId,
        repoFullName: params.repoFullName,
        taskPrompt: params.prompt,
        corrections: task.corrections,
        thread,
      },
    ).catch((err) => log.warn({ err }, "memory suggestion failed"));

    return out("done", {
      pushed: true,
      prNumber,
      summary,
      diffFiles,
      verified,
      ...(failing.length > 0 ? { failingChecks: failing } : {}),
    });
  }

  /** Live task count for a guild (saturation checks — e.g. Repro Gate skips). */
  runningCount(guildId: string): number {
    return this.limiter.runningCount(guildId);
  }

  /** Look at a proposed plan without consuming it (TTL-bounded). */
  peekPendingPlan(taskId: string): PendingPlan | undefined {
    this.sweepPendingPlans();
    return this.pendingPlans.get(taskId);
  }

  /** Claim a proposed plan (single-use, TTL-bounded) on an Implement click. */
  takePendingPlan(taskId: string): PendingPlan | undefined {
    this.sweepPendingPlans();
    const plan = this.pendingPlans.get(taskId);
    if (plan) this.pendingPlans.delete(taskId);
    return plan;
  }

  /** Drop plans older than PLAN_VOTE_TTL_MINUTES so the map can't grow unbounded. */
  private sweepPendingPlans(): void {
    const cutoff = Date.now() - this.config.PLAN_VOTE_TTL_MINUTES * 60_000;
    for (const [id, plan] of this.pendingPlans) {
      if (plan.createdAt < cutoff) this.pendingPlans.delete(id);
    }
  }

  /** Spectate: verbose progress for everyone watching the thread. One-way. */
  enableSpectate(taskId: string): boolean {
    const task = [...this.active.values()].find((t) => t.taskId === taskId);
    if (!task?.renderer) return false;
    task.renderer.enableVerbose();
    return true;
  }

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
    if (status !== "done" && task.charged)
      await refundUsage(this.db, task.guildId, task.mode, task.fundedBy);
  }
}

/** Guards against a hung Docker daemon jamming a guild's task slot. */
const WORKSPACE_START_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function progressEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0x5865f2).setDescription(description);
}

/** Implement / Dismiss buttons posted under a plan-mode proposal. */
export function planApprovalButtons(
  taskId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`aw:planimpl:${taskId}`)
      .setLabel("Approve & Implement ✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`aw:plandismiss:${taskId}`)
      .setLabel("Dismiss")
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * The accountability layer's public artifact: every agent PR says who asked,
 * who approved, who steered, and what was verified — with a link to the
 * public thread where it all happened.
 */
export function provenanceReceipt(args: {
  initiatedBy: string;
  planApprovedBy: string | null;
  steeredBy: string[];
  testResults: Array<{ passed: boolean; summary: string }>;
  diffFiles: Array<{ path: string; additions: number; deletions: number }>;
  threadUrl: string;
}): string {
  const verified: string[] = [];
  for (const t of args.testResults.slice(-3)) {
    verified.push(`${t.passed ? "✅" : "❌"} ${t.summary.slice(0, 120)}`);
  }
  if (args.diffFiles.length > 0) {
    const add = args.diffFiles.reduce((n, f) => n + f.additions, 0);
    const del = args.diffFiles.reduce((n, f) => n + f.deletions, 0);
    verified.push(`diff: ${args.diffFiles.length} file(s), +${add} −${del}`);
  }
  return [
    "---",
    "### 🧾 Provenance",
    `- **Initiated by:** ${args.initiatedBy} — human sponsor`,
    ...(args.planApprovedBy
      ? [`- **Plan approved by:** discord:${args.planApprovedBy}`]
      : []),
    ...(args.steeredBy.length > 0
      ? [`- **Steered by:** ${args.steeredBy.map((s) => `discord:${s}`).join(", ")}`]
      : []),
    `- **Verified:** ${verified.length > 0 ? verified.join(" · ") : "no test evidence recorded"}`,
    `- **Task thread:** ${args.threadUrl}`,
    "",
    "_Opened by AnyWareCode from a Discord session; humans remain the merge gate._",
  ].join("\n");
}

const MAX_DIFF_FILES = 20;

export function whatChangedEmbed(
  files: Array<{ path: string; additions: number; deletions: number }>,
): EmbedBuilder {
  const shown = files.slice(0, MAX_DIFF_FILES);
  const lines = shown.map(
    (f) => `\`${f.path}\` **+${f.additions}** −${f.deletions}`,
  );
  if (files.length > MAX_DIFF_FILES) {
    lines.push(`…and ${files.length - MAX_DIFF_FILES} more file(s)`);
  }
  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("What changed")
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({
      text: `${files.length} file(s), +${totalAdd} −${totalDel}`,
    });
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
