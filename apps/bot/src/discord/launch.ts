import {
	Routes,
	type APIInteractionGuildMember,
	type Client,
	type GuildMember,
	type ThreadChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import type { TranscriptEntry } from "@anywarecode/shared";
import { schema } from "@anywarecode/db";
import type { Guild } from "@anywarecode/db";
import { isClaudeOauthEnabled } from "../flags.js";
import { createInstallState } from "../github/install-state.js";
import {
	hasInstallation,
	resolveInstallationForRepo,
} from "../github/installations.js";
import { getUserLink, userLinkingEnabled } from "../github/user-link.js";
import { resolveLlmAuth, type ResolvedLlmAuth } from "../llm/credentials.js";
import { probeModel } from "../llm/failures.js";
import { buildTaskFailureMessage } from "../llm/messages.js";
import { callWithRetry } from "../llm/retry.js";
import { captureError } from "../observability.js";
import type { RunOutcome } from "../orchestrator/taskRunner.js";
import { bumpUsage, type FundedBy } from "../orchestrator/usage.js";
import { canInvoke, capState, resolveTier } from "./gates.js";
import type { BotContext } from "./interactions.js";

/**
 * Shared task-launch path. All entry points (slash commands, the Iterate
 * button, @mentions, proposal Run buttons) funnel through here so permission,
 * cap, repo and usage accounting live in exactly one place.
 */

export type PreconditionResult =
	| { ok: true; repoFullName: string; installationId: number }
	| { ok: false; reason: string };

/** Where the task's repo comes from: a bound channel (binding carries the
 * owning installation), or directly with the installation the caller already
 * knows (webhook features hold payload.installation.id). */
export type RepoRef =
	| { channelId: string }
	| { repoFullName: string; installationId: number };

export async function checkTaskPreconditions(
	ctx: BotContext,
	guild: Guild,
	member: GuildMember | APIInteractionGuildMember | null,
	mode: "code" | "ask",
	repoRef: RepoRef,
	prompt: string,
): Promise<PreconditionResult> {
	if (!member) {
		return {
			ok: false,
			reason: "Couldn't resolve your server membership; try again.",
		};
	}
	if (!canInvoke(guild, member)) {
		return {
			ok: false,
			reason:
				"You don't have permission to run agent tasks here. Ask an admin to grant your role with `/config role`.",
		};
	}
	// Accountability gate: this server requires code-task sponsors to carry a
	// verified GitHub identity on the provenance receipt.
	if (
		mode === "code" &&
		guild.requireLinkedSponsor &&
		userLinkingEnabled(ctx.config)
	) {
		const userId =
			"user" in member && member.user
				? member.user.id
				: (member as GuildMember).id;
		if (!(await getUserLink(ctx.db, userId))) {
			return {
				ok: false,
				reason:
					"This server requires a linked GitHub identity to sponsor agent tasks — run `/link github` first.",
			};
		}
	}
	return checkSystemTaskPreconditions(ctx, guild, mode, repoRef, prompt);
}

/**
 * Everything except the member check — system-initiated launches (auto-review)
 * have no clicking member. Human entry points go through
 * checkTaskPreconditions, which adds the membership/permission gate.
 */
export async function checkSystemTaskPreconditions(
	ctx: BotContext,
	guild: Guild,
	mode: "code" | "ask",
	repoRef: RepoRef,
	prompt: string,
): Promise<PreconditionResult> {
	if (guild.suspended) {
		return {
			ok: false,
			reason:
				"This server's access has been suspended. Contact the operator.",
		};
	}
	if (prompt.trim().length === 0) {
		return {
			ok: false,
			reason: "Give me something to work on — the task is empty.",
		};
	}
	if (prompt.length > ctx.config.MAX_PROMPT_CHARS) {
		return {
			ok: false,
			reason: `That's too long (${prompt.length} chars; max ${ctx.config.MAX_PROMPT_CHARS}). Trim it and try again.`,
		};
	}
	if (!(await hasInstallation(ctx.db, guild.id))) {
		const state = await createInstallState(
			ctx.db,
			ctx.config.STATE_SECRET,
			guild.id,
			ctx.config.INSTALL_STATE_TTL_MINUTES,
		);
		return {
			ok: false,
			reason: `GitHub isn't connected yet. An admin needs to [install the GitHub App](${ctx.github.installUrl(state)}).`,
		};
	}
	const llmRes = await resolveLlmAuth(ctx.db, ctx.config, guild.id);
	if (!llmRes.auth) {
		return {
			ok: false,
			reason: "LLM not connected. An admin needs to run `/connect llm`.",
		};
	}
	// Capture the narrowed, non-null auth so the discriminated-union field stays
	// typed through the probe below (assertLlmUsable takes the wrapper, so TS
	// can't carry the narrowing forward on its own).
	const auth = llmRes.auth;
	const usable = await assertLlmUsable(ctx, guild, llmRes);
	if (!usable.ok) return usable;

	// Preflight probe: confirm the required model actually responds before any
	// thread, task row, or container is created. On any non-success, surface the
	// task-path failure copy and bail (Req 5.1–5.7, 8.6).
	const requiredModel =
		mode === "code" ? ctx.config.CODE_MODEL : ctx.config.DEFAULT_MODEL;
	const probe = await callWithRetry(
		() =>
			probeModel({
				auth,
				model: requiredModel,
				timeoutMs: ctx.config.CLASSIFIER_TIMEOUT_SECONDS * 1000,
			}),
		{ maxRetryDelayMs: ctx.config.RETRY_MAX_DELAY_SECONDS * 1000 },
	);
	if (!probe.ok) {
		const customModelName = auth.type === "custom" ? auth.model : null;
		return {
			ok: false,
			reason: buildTaskFailureMessage({
				failure: probe.failure,
				providerType: auth.type,
				customModelName,
			}),
		};
	}

	let repoFullName: string;
	let installationId: number | null;
	if ("repoFullName" in repoRef) {
		repoFullName = repoRef.repoFullName;
		installationId = repoRef.installationId;
	} else {
		const channelRepo = await ctx.db.query.channelRepos.findFirst({
			where: eq(schema.channelRepos.channelId, repoRef.channelId),
		});
		if (!channelRepo) {
			return {
				ok: false,
				reason: "No repo set for this channel yet — run `/repo set` first.",
			};
		}
		repoFullName = channelRepo.repoFullName;
		installationId =
			channelRepo.installationId ??
			(await resolveInstallationForRepo(
				ctx.db,
				ctx.github,
				guild.id,
				repoFullName,
			));
	}
	if (!installationId) {
		return {
			ok: false,
			reason: `No linked GitHub installation has access to \`${repoFullName}\` — re-run \`/repo set\` or \`/connect github\`.`,
		};
	}
	// OSS tier is for public repos only; recheck lazily in case one went private.
	if (
		resolveTier(guild).kind === "oss" &&
		(await ctx.github.repoIsPrivate(installationId, repoFullName))
	) {
		return {
			ok: false,
			reason: `\`${repoFullName}\` is private — the OSS Community tier only runs on public repos.`,
		};
	}
	const cap = capState(guild, mode);
	if (cap.exceeded) {
		return { ok: false, reason: capExceededMessage(ctx, guild, mode, cap) };
	}
	return {
		ok: true,
		repoFullName,
		installationId,
	};
}

/**
 * Shared credential gating used by the launch funnel and the mention handler.
 * BYO-LLM only: every server connects its own credential (no platform key, no
 * trial). The only runtime gate left is the claude_oauth kill switch.
 */
export async function assertLlmUsable(
	ctx: BotContext,
	_guild: Guild,
	resolved: ResolvedLlmAuth,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (!resolved.auth) {
		return {
			ok: false,
			reason: "LLM not connected. An admin needs to run `/connect llm`.",
		};
	}
	if (
		resolved.auth.type === "claude_oauth" &&
		!(await isClaudeOauthEnabled(ctx.db))
	) {
		return {
			ok: false,
			reason:
				"Subscription-token connections are currently disabled. An admin should run `/connect llm` and switch to an Anthropic API key.",
		};
	}
	return { ok: true };
}

/** Cap-hit copy; the growth hook is that any member can buy a pack. */
export function capExceededMessage(
	ctx: BotContext,
	guild: Guild,
	mode: "code" | "ask",
	cap: { used: number; cap: number },
): string {
	const base = `This server hit its monthly ${mode === "code" ? "task" : "question"} limit (${cap.used}/${cap.cap}). Resets ${guild.capResetAt.toDateString()}.`;
	if (mode !== "code") return base;
	return `${base}\nRun \`/billing\` to add a Job Pack or upgrade — any member can buy a pack.`;
}

export type ThreadStrategy =
	| {
			kind: "create";
			client: Client;
			/** Text channel holding the anchor message the thread is opened from. */
			channelId: string;
			anchorMessageId: string;
			name: string;
	  }
	| { kind: "existing"; thread: ThreadChannel };

export interface LaunchTaskRequest {
	guildId: string;
	installationId: number;
	repoFullName: string;
	/** Parent text channel recorded on the task row (repo binding channel). */
	channelId: string;
	mode: "code" | "ask";
	prompt: string;
	requestedBy: string;
	/** Sponsor's Discord user id (provenance: GitHub identity lookup). */
	requestedById?: string;
	/** Provenance: who approved the plan vote (omitted = instant mode). */
	planApprovedBy?: string;
	/** Per-task model override (paid tiers; ignored for custom providers). */
	model?: string;
	/** Plan-first: run the agent in plan mode and post the plan for approval. */
	planMode?: boolean;
	thread: ThreadStrategy;
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
	/** Quota already claimed by the caller (squad batches via claimUnits). */
	prefundedBy?: FundedBy;
	/** Caller-supplied task id (squads pre-generate ids to link attempts). */
	taskId?: string;
	/** Squad attempts: push the branch but defer PR creation to the vote. */
	deferPr?: boolean;
}

export interface LaunchedTask {
	thread: ThreadChannel;
	/** Resolves when the run finishes; never rejects (crash → failed outcome). */
	outcome: Promise<RunOutcome>;
}

export async function launchTask(
	ctx: BotContext,
	req: LaunchTaskRequest,
): Promise<LaunchedTask> {
	let thread: ThreadChannel;
	if (req.thread.kind === "existing") {
		thread = req.thread.thread;
	} else {
		// Use REST directly — avoids requiring the parent channel to be in discord.js cache
		const { client, channelId, anchorMessageId, name } = req.thread;
		const threadRaw = (await client.rest.post(
			Routes.threads(channelId, anchorMessageId),
			{
				body: {
					name: truncate(name, 90),
					auto_archive_duration: 1440,
				},
			},
		)) as { id: string };
		thread = (await client.channels.fetch(threadRaw.id)) as ThreadChannel;
	}

	// Plan-mode runs are free; the unit is charged when "Approve & Implement" is
	// clicked (which launches a normal code run through this same path).
	const fundedBy = req.planMode
		? "plan"
		: (req.prefundedBy ?? (await bumpUsage(ctx.db, req.guildId, req.mode)));
	// /code defaults to a stronger model (deeper work); /ask + chat keep
	// DEFAULT_MODEL. An explicit pick always wins; custom providers ignore it.
	const model =
		req.model ?? (req.mode === "code" ? ctx.config.CODE_MODEL : undefined);
	const outcome = ctx.orchestrator
		.run({
			guildId: req.guildId,
			installationId: req.installationId,
			channelId: req.channelId,
			thread,
			repoFullName: req.repoFullName,
			prompt: req.prompt,
			requestedBy: req.requestedBy,
			mode: req.mode,
			fundedBy,
			...(req.requestedById ? { requestedById: req.requestedById } : {}),
			...(req.planApprovedBy ? { planApprovedBy: req.planApprovedBy } : {}),
			...(model ? { model } : {}),
			...(req.planMode ? { planMode: true } : {}),
			...(req.taskId ? { taskId: req.taskId } : {}),
			...(req.deferPr ? { deferPr: true } : {}),
			...(req.iterate ? { iterate: req.iterate } : {}),
			...(req.transcript ? { transcript: req.transcript } : {}),
			...(req.checkoutRef ? { checkoutRef: req.checkoutRef } : {}),
			...(req.summaryTarget ? { summaryTarget: req.summaryTarget } : {}),
		})
		.catch(async (err: unknown): Promise<RunOutcome> => {
			captureError(err, { msg: "task crashed", threadId: thread.id });
			await thread
				.send("⚠️ The task crashed before finishing. Check the bot logs.")
				.catch(() => {});
			return {
				taskId: "crashed",
				status: "failed",
				pushed: false,
				branch: "",
				prNumber: null,
				diffFiles: [],
			};
		});
	return { thread, outcome };
}

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
