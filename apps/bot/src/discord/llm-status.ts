/**
 * Admin `/llm-status` command handler (Req 11).
 *
 * Probes each configured Model_Tier (`CHAT_MODEL`, `DEFAULT_MODEL`,
 * `CODE_MODEL`) for the guild's connected credential and renders an ephemeral
 * status report: the connected provider type, the per-tier success/Failure_Mode
 * outcome, and — for rate-limited tiers with a known Reset_Time — a
 * human-friendly recovery time. The report is mention-safe (`sanitizeUserMessage`)
 * and NEVER includes the credential token or any authorization header (Req 11.6).
 *
 * Access is gated on `ManageGuild`; a non-admin request is denied with no
 * probing at all (Req 11.4). Results are cached per-guild for 60s so a repeat
 * request inside the window re-renders the previous probe without issuing new
 * network calls (Req 11.5).
 *
 * `BotContext` is imported type-only (mirroring `connect.ts`/`review.ts`) so no
 * runtime import cycle is introduced via `interactions.js`.
 */

import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { BotContext } from "./interactions.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { probeModel, type LlmCallResult } from "../llm/failures.js";
import { callWithRetry } from "../llm/retry.js";
import { formatResetTime, sanitizeUserMessage } from "../llm/messages.js";

/** Per-probe timeout used for each Model_Tier probe (Req 11.2). */
const PROBE_TIMEOUT_MS = 10_000;
/** Per-guild probe cache window (Req 11.5). */
const PROBE_CACHE_TTL_MS = 60_000;

/** One probed Model_Tier and its classified outcome. */
interface TierProbe {
	tier: "chat" | "default" | "code";
	model: string;
	result: LlmCallResult;
}

/** A cached probe snapshot for a single guild. */
interface ProbeCacheEntry {
	atMs: number;
	providerType: string;
	tiers: TierProbe[];
}

/**
 * In-memory per-guild probe cache (Req 11.5). Best-effort: a miss simply
 * triggers fresh probes. Exported so tests can reset state between cases.
 */
export const probeCache = new Map<string, ProbeCacheEntry>();

/** Test helper: clear all cached probe snapshots. */
export function clearProbeCache(): void {
	probeCache.clear();
}

/**
 * Optional injected dependencies for deterministic testing (task 10.3).
 *  - `probe`: stand-in for {@link probeModel} so tests can fake provider
 *    responses without real network I/O.
 *  - `nowMs`: injectable clock used for cache-TTL decisions and timestamps so
 *    the 60s cache window can be exercised deterministically.
 *
 * Both default to the real implementations (`probeModel` / `Date.now`).
 */
export interface LlmStatusOpts {
	probe?: typeof probeModel;
	nowMs?: () => number;
}

/**
 * Render the human-readable line for a single probed tier (Req 11.2, 11.3).
 * Never includes any auth material — only the tier label, model name, and the
 * classified outcome (success or Failure_Mode, plus a reset time when known).
 */
function renderTierLine(probe: TierProbe): string {
	const label = `**${probe.tier}** (\`${probe.model}\`)`;
	if (probe.result.ok) {
		return `${label}: ✅ success`;
	}
	const { failure } = probe.result;
	if (failure.mode === "rate_limited") {
		const resetMs = failure.rateLimitInfo?.resetTimeMs;
		if (resetMs != null) {
			const { absolute, relative } = formatResetTime(resetMs);
			return `${label}: ⛔ rate_limited — recovers ${relative} (${absolute})`;
		}
		return `${label}: ⛔ rate_limited — recovery time unknown`;
	}
	return `${label}: ⚠️ ${failure.mode}`;
}

/**
 * Render the full ephemeral status report from a cache entry (Req 11.1–11.3,
 * 11.6). The final string is passed through `sanitizeUserMessage` so it is
 * mention-safe and length-bounded, and by construction contains only the
 * provider type and per-tier outcomes — never the token or auth header.
 */
function renderReport(entry: ProbeCacheEntry): string {
	const lines = [
		`**LLM status** — provider: \`${entry.providerType}\``,
		...entry.tiers.map(renderTierLine),
	];
	return sanitizeUserMessage(lines.join("\n"));
}

/**
 * Handle the admin `/llm-status` command.
 *
 * @param ctx Bot context (`db`, `config`, …). Imported type-only.
 * @param interaction The slash-command interaction.
 * @param opts Optional injected `probe`/`nowMs` for tests (defaults to real impls).
 */
export async function handleLlmStatusCommand(
	ctx: BotContext,
	interaction: ChatInputCommandInteraction,
	opts?: LlmStatusOpts,
): Promise<void> {
	const probe = opts?.probe ?? probeModel;
	const nowMs = opts?.nowMs ?? (() => Date.now());

	// 1) Admin gate — deny with no probing for non-admins (Req 11.4).
	if (!interaction.memberPermissions?.has("ManageGuild")) {
		await interaction.reply({
			content: "Admin permission required",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2) Must run inside a guild to resolve a credential.
	const guildId = interaction.guildId;
	if (!guildId) {
		await interaction.reply({
			content: "This command can only be used in a server.",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 3) Serve a fresh-enough cache entry without re-probing (Req 11.5).
	const cached = probeCache.get(guildId);
	if (cached && nowMs() - cached.atMs < PROBE_CACHE_TTL_MS) {
		await interaction.reply({
			content: renderReport(cached),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 4) Resolve the guild credential; bail with the reason when unavailable.
	const resolved = await resolveLlmAuth(ctx.db, ctx.config, guildId);
	if (resolved.auth === null) {
		await interaction.reply({
			content: sanitizeUserMessage(resolved.reason),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	const { auth } = resolved;

	// 5) Probe each configured Model_Tier, each wrapped once by callWithRetry
	//    with a 10s per-probe timeout (Req 11.2).
	const tierSpecs: { tier: TierProbe["tier"]; model: string }[] = [
		{ tier: "chat", model: ctx.config.CHAT_MODEL },
		{ tier: "default", model: ctx.config.DEFAULT_MODEL },
		{ tier: "code", model: ctx.config.CODE_MODEL },
	];
	const maxRetryDelayMs = ctx.config.RETRY_MAX_DELAY_SECONDS * 1000;

	const tiers: TierProbe[] = [];
	for (const { tier, model } of tierSpecs) {
		const result = await callWithRetry(
			() => probe({ auth, model, timeoutMs: PROBE_TIMEOUT_MS, nowMs }),
			{ maxRetryDelayMs },
		);
		tiers.push({ tier, model, result });
	}

	// 6) Cache the snapshot and render the ephemeral report (Req 11.1–11.3, 11.6).
	const entry: ProbeCacheEntry = {
		atMs: nowMs(),
		providerType: auth.type,
		tiers,
	};
	probeCache.set(guildId, entry);

	await interaction.reply({
		content: renderReport(entry),
		flags: MessageFlags.Ephemeral,
	});
}
