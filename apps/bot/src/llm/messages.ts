/**
 * Pure message-builder for the LLM rate-limit resilience feature.
 *
 * This module is intentionally pure: no Discord client, no I/O, no DB imports.
 * Callers post the returned strings via the existing mention-safe `reply()`
 * helper.
 */

import type { LlmAuth } from "./credentials.js";
import type { LlmFailure, RateLimitInfo } from "./failures.js";

/** Discord hard limit for a single message body. */
const MAX_MESSAGE_LENGTH = 2000;

/** Marker inserted where the middle of an over-long message is trimmed. */
const ELLIPSIS = "\n…\n";

/**
 * Neutralize Discord mention tokens so a message can never ping anyone, even
 * before `allowedMentions` is applied (defense in depth). A zero-width space
 * (`\u200b`) is inserted to break the token without visibly altering the text:
 *  - `@everyone` → `@\u200beveryone`
 *  - `@here`     → `@\u200bhere`
 *  - `<@123>`    → `<@\u200b123>`   (user mention)
 *  - `<@&123>`   → `<@\u200b&123>`  (role mention — also starts with `<@`)
 */
function neutralizeMentions(input: string): string {
	return input
		.replace(/@everyone/g, "@\u200beveryone")
		.replace(/@here/g, "@\u200bhere")
		.replace(/<@/g, "<@\u200b");
}

/**
 * Final safety pass applied to every built message: neutralizes mention tokens
 * and truncates to at most 2000 characters. When `preserveTail` is provided
 * (e.g. the "hit its usage/rate limit" statement plus the Reset_Time), the
 * message is trimmed from the middle so the tail fragment always survives.
 *
 * Requirements: 3.4, 3.5, 3.6, 4.6, 4.7, 5.8
 */
export function sanitizeUserMessage(s: string, preserveTail?: string): string {
	const neutralized = neutralizeMentions(s);

	// No tail to preserve: neutralize then hard-truncate from the end.
	if (preserveTail === undefined || preserveTail.length === 0) {
		return neutralized.length <= MAX_MESSAGE_LENGTH
			? neutralized
			: neutralized.slice(0, MAX_MESSAGE_LENGTH);
	}

	const tail = neutralizeMentions(preserveTail);

	// Already within budget: nothing to trim.
	if (neutralized.length <= MAX_MESSAGE_LENGTH) {
		return neutralized;
	}

	// Degenerate case: the tail alone meets or exceeds the budget. Keep the end
	// of the tail so the trailing Reset_Time token survives.
	if (tail.length >= MAX_MESSAGE_LENGTH) {
		return tail.slice(tail.length - MAX_MESSAGE_LENGTH);
	}

	// Avoid duplicating the tail when it is already the suffix of the body.
	let body = neutralized;
	if (body.endsWith(tail)) {
		body = body.slice(0, body.length - tail.length);
	}

	// Include the ellipsis marker only if it fits alongside the tail.
	const ellipsis =
		tail.length + ELLIPSIS.length <= MAX_MESSAGE_LENGTH ? ELLIPSIS : "";
	const headBudget = MAX_MESSAGE_LENGTH - tail.length - ellipsis.length;
	const head = headBudget > 0 ? body.slice(0, headBudget) : "";

	return head + ellipsis + tail;
}

/**
 * Render a Reset_Time (epoch ms) as Discord timestamp tokens. Discord displays
 * these unambiguously in each viewer's local timezone.
 *  - `absolute`: `<t:EPOCH:F>` (full date and time)
 *  - `relative`: `<t:EPOCH:R>` (relative duration until recovery)
 *
 * Requirements: 3.2, 5.2 (rendering used by the message builders in task 4.2)
 */
export function formatResetTime(resetTimeMs: number): {
	absolute: string;
	relative: string;
} {
	const epoch = Math.floor(resetTimeMs / 1000);
	return { absolute: `<t:${epoch}:F>`, relative: `<t:${epoch}:R>` };
}

/**
 * Context for building a user-facing failure message: the classified failure,
 * the connected provider type (or `"unknown"` when it cannot be determined),
 * and the configured custom model name for `custom` providers.
 */
export interface MessageContext {
	failure: LlmFailure;
	providerType: LlmAuth["type"] | "unknown";
	/** For provider "custom" (Req 7.3/7.4). */
	customModelName?: string | null;
}

/** Canonical statement that the credential hit its usage/rate limit. Kept as a
 *  single phrase so it can be preserved verbatim through truncation and matched
 *  by content tests (Req 3.1, 5.1). */
const RATE_LIMIT_PHRASE = "hit its usage or rate limit";

/**
 * Render the recovery portion of a chat-path rate-limit message. When a
 * Reset_Time is known, includes BOTH the Discord relative (`<t:EPOCH:R>`) and
 * absolute (`<t:EPOCH:F>`) tokens so every viewer sees an unambiguous time
 * regardless of timezone (Req 3.2). When unknown, states recovery is unknown
 * and to retry after the usage window resets, with no `<t:` token (Req 3.3).
 */
function chatResetText(info: RateLimitInfo | undefined): string {
	if (info?.resetTimeMs != null) {
		const { absolute, relative } = formatResetTime(info.resetTimeMs);
		return ` Service should recover ${relative} (${absolute}).`;
	}
	return " The recovery time is unknown — retry after the credential's usage window resets.";
}

/**
 * Render the recovery portion of a task-path rate-limit message. When a
 * Reset_Time is known, includes the absolute wall-clock timestamp
 * (`<t:EPOCH:F>`) only (Req 5.2). When unknown, states recovery is unknown
 * (Req 5.3).
 */
function taskResetText(info: RateLimitInfo | undefined): string {
	if (info?.resetTimeMs != null) {
		const { absolute } = formatResetTime(info.resetTimeMs);
		return ` Service should recover by ${absolute}.`;
	}
	return " The recovery time is unknown — retry after the credential's usage window resets.";
}

/**
 * Provider-aware suffix appended to a message (Req 7):
 *  - `claude_oauth` + `rate_limited`: subscription/heavier-tier note (Req 7.1).
 *  - `anthropic_api_key`: no subscription-specific text (Req 7.2).
 *  - `custom` with a model name: reference the configured model, never naming
 *    an Anthropic tier (Req 7.3); without one, generic (empty) wording (Req 7.4).
 *  - `unknown`: no provider/subscription specifics (Req 7.5).
 */
function providerSuffix(
	mode: LlmFailure["mode"],
	providerType: MessageContext["providerType"],
	customModelName?: string | null,
): string {
	if (providerType === "claude_oauth" && mode === "rate_limited") {
		return " Subscription credentials exhaust heavier model tiers before lighter ones, so lighter models may still respond.";
	}
	if (providerType === "custom" && customModelName) {
		return ` This concerns the configured model \`${customModelName}\`.`;
	}
	return "";
}

/**
 * Build the Chat_Path user-facing message for any non-success failure
 * (Req 3, 4, 7). Returns exactly one non-empty, mention-safe string. For
 * `rate_limited`, the usage/rate-limit statement plus Reset_Time are passed as
 * the `preserveTail` so they survive truncation (Req 3.6).
 */
export function buildChatFailureMessage(ctx: MessageContext): string {
	const { failure, providerType, customModelName } = ctx;
	const suffix = providerSuffix(failure.mode, providerType, customModelName);

	switch (failure.mode) {
		case "rate_limited": {
			const statement = `The connected LLM credential has ${RATE_LIMIT_PHRASE}.${chatResetText(
				failure.rateLimitInfo,
			)}`;
			return sanitizeUserMessage(`${statement}${suffix}`, statement);
		}
		case "auth_failed":
			return sanitizeUserMessage(
				`The connected LLM credential is invalid. An admin needs to run \`/connect llm\` to restore service.${suffix}`,
			);
		case "overloaded":
			return sanitizeUserMessage(
				`The LLM provider is temporarily overloaded. Please retry after at least 30 seconds.${suffix}`,
			);
		case "model_error":
			return sanitizeUserMessage(
				`The request could not be processed by the selected model. Retrying the same request unchanged is unlikely to succeed.${suffix}`,
			);
		case "network_error":
			return sanitizeUserMessage(
				`The LLM provider could not be reached. Please retry after at least 30 seconds.${suffix}`,
			);
	}
}

/**
 * Build the Task_Path user-facing message for any non-success failure
 * (Req 5, 7). Returns exactly one non-empty, mention-safe string. For
 * `rate_limited`, the usage/rate-limit statement plus Reset_Time are passed as
 * the `preserveTail` so they survive truncation (Req 5.8 + 3.6 semantics).
 */
export function buildTaskFailureMessage(ctx: MessageContext): string {
	const { failure, providerType, customModelName } = ctx;
	const suffix = providerSuffix(failure.mode, providerType, customModelName);

	switch (failure.mode) {
		case "rate_limited": {
			const statement = `The connected LLM credential has ${RATE_LIMIT_PHRASE} on the required model.${taskResetText(
				failure.rateLimitInfo,
			)}`;
			return sanitizeUserMessage(`${statement}${suffix}`, statement);
		}
		case "auth_failed":
			return sanitizeUserMessage(
				`The task can't start: the connected LLM credential is invalid. An admin needs to run \`/connect llm\`.${suffix}`,
			);
		case "overloaded":
			return sanitizeUserMessage(
				`The task can't start: the LLM provider is overloaded. Please retry shortly.${suffix}`,
			);
		case "network_error":
			return sanitizeUserMessage(
				`The task can't start: a network error prevented reaching the LLM provider. Please retry shortly.${suffix}`,
			);
		case "model_error":
			return sanitizeUserMessage(
				`The task can't start: the required model could not process the request. Retrying the same request unchanged is unlikely to succeed.${suffix}`,
			);
	}
}

/**
 * Mention-safe prefix stating the reply was produced by a lighter model due to
 * rate limits, prepended to a Fallback_Model reply on the Chat_Path (Req 6.4).
 */
export function lighterModelNotice(): string {
	return sanitizeUserMessage(
		"_Reply produced by a lighter model due to rate limits._\n\n",
	);
}
