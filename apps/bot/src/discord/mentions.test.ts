import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "discord.js";
import type { LlmFailure } from "../llm/failures.js";
import { classifyIntent, generateChatReply } from "../llm/chat.js";
import { resolveLlmAuth } from "../llm/credentials.js";
import { assertLlmUsable } from "./launch.js";
import { ensureGuild } from "./gates.js";
import {
	ChatRateLimiter,
	handleMention,
	isBotMentioned,
	routeMessage,
	stripBotMention,
} from "./mentions.js";
import type { BotContext } from "./interactions.js";

// The orchestration tests below exercise handleMention's classify/reply
// branching, fallback, no-generic-string, and allowedMentions invariants.
// We mock the bot-side LLM shells (classifyIntent/generateChatReply) so we can
// drive each structured ClassifyResult/ReplyResult deterministically, and stub
// the surrounding Discord/credential gates so the test focuses purely on the
// branch logic. The pure message-builder (messages.ts) and retry wrapper
// (retry.ts) run for real, so the asserted user-facing copy is the real copy.
vi.mock("../llm/chat.js", async (importActual) => {
	const actual = await importActual<typeof import("../llm/chat.js")>();
	return { ...actual, classifyIntent: vi.fn(), generateChatReply: vi.fn() };
});
vi.mock("../llm/credentials.js", async (importActual) => {
	const actual = await importActual<typeof import("../llm/credentials.js")>();
	return { ...actual, resolveLlmAuth: vi.fn() };
});
vi.mock("./launch.js", async (importActual) => {
	const actual = await importActual<typeof import("./launch.js")>();
	return { ...actual, assertLlmUsable: vi.fn() };
});
vi.mock("./gates.js", async (importActual) => {
	const actual = await importActual<typeof import("./gates.js")>();
	return { ...actual, ensureGuild: vi.fn() };
});

const BOT = "111222333444555666";
const ROLE = "777888999000111222";

describe("isBotMentioned", () => {
	it("detects an explicit user mention", () => {
		expect(isBotMentioned(`hey <@${BOT}> fix it`, BOT, [ROLE])).toBe(true);
	});

	it("detects the nickname mention form", () => {
		expect(isBotMentioned(`<@!${BOT}> hello`, BOT, [ROLE])).toBe(true);
	});

	it("detects the bot's managed role mention", () => {
		expect(isBotMentioned(`<@&${ROLE}> look at this`, BOT, [ROLE])).toBe(
			true,
		);
	});

	it("ignores @everyone and @here", () => {
		expect(isBotMentioned("@everyone deploy is broken", BOT, [ROLE])).toBe(
			false,
		);
		expect(isBotMentioned("@here anyone around?", BOT, [ROLE])).toBe(false);
	});

	it("ignores mentions of other users and roles", () => {
		expect(isBotMentioned("<@999> <@&888> hi", BOT, [ROLE])).toBe(false);
	});

	it("ignores implicit reply pings (no token in content)", () => {
		// A reply to a bot message pings via message reference, not content.
		expect(isBotMentioned("thanks, looks good!", BOT, [ROLE])).toBe(false);
	});
});

describe("stripBotMention", () => {
	it("strips leading and inline user mentions", () => {
		expect(stripBotMention(`<@${BOT}> fix the <@${BOT}> bug`, BOT, [])).toBe(
			"fix the bug",
		);
	});

	it("strips nickname and role forms and collapses whitespace", () => {
		expect(
			stripBotMention(`<@!${BOT}>   please <@&${ROLE}>  help`, BOT, [ROLE]),
		).toBe("please help");
	});

	it("leaves other mentions intact", () => {
		expect(stripBotMention(`<@${BOT}> ask <@999>`, BOT, [])).toBe(
			"ask <@999>",
		);
	});
});

describe("routeMessage", () => {
	const base = {
		isBot: false,
		isThread: false,
		hasActiveTask: false,
		isMentioned: false,
		hasContent: true,
	};

	it.each([
		[{ ...base, isBot: true, isMentioned: true }, { kind: "ignore" }],
		[{ ...base, hasContent: false, isMentioned: true }, { kind: "ignore" }],
		[{ ...base, isThread: true, hasActiveTask: true }, { kind: "forward" }],
		[
			{ ...base, isThread: true, hasActiveTask: true, isMentioned: true },
			{ kind: "forward" },
		],
		[
			{ ...base, isThread: true, isMentioned: true },
			{ kind: "classify", scope: "thread" },
		],
		[{ ...base, isThread: true }, { kind: "ignore" }],
		[
			{ ...base, isMentioned: true },
			{ kind: "classify", scope: "channel" },
		],
		[base, { kind: "ignore" }],
	])("routes %j to %j", (flags, expected) => {
		expect(routeMessage(flags)).toEqual(expected);
	});
});

describe("ChatRateLimiter", () => {
	it("allows up to the limit then blocks within the window", () => {
		const limiter = new ChatRateLimiter(2);
		const t0 = 1_000_000;
		expect(limiter.allow("g1", t0)).toBe(true);
		expect(limiter.allow("g1", t0 + 1)).toBe(true);
		expect(limiter.allow("g1", t0 + 2)).toBe(false);
	});

	it("frees slots as the window slides", () => {
		const limiter = new ChatRateLimiter(1);
		const t0 = 1_000_000;
		expect(limiter.allow("g1", t0)).toBe(true);
		expect(limiter.allow("g1", t0 + 30_000)).toBe(false);
		expect(limiter.allow("g1", t0 + 60_001)).toBe(true);
	});

	it("isolates guilds", () => {
		const limiter = new ChatRateLimiter(1);
		const t0 = 1_000_000;
		expect(limiter.allow("g1", t0)).toBe(true);
		expect(limiter.allow("g2", t0)).toBe(true);
		expect(limiter.allow("g1", t0 + 1)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// handleMention orchestration (Req 3.5, 4.7, 6.3–6.7, 8.1–8.5)
// ---------------------------------------------------------------------------

const GENERIC = "couldn't generate a response";
const RATE_LIMIT_PHRASE = "hit its usage or rate limit";
const LIGHTER_NOTICE = "lighter model due to rate limits";

const SAFE_MENTIONS = { parse: [], repliedUser: true };

/** A rate-limited failure whose retry-after exceeds any sane max delay, so the
 *  real callWithRetry always SKIPS the retry — giving each wrapped call exactly
 *  one attempt and therefore deterministic, assertable call counts. */
function rateLimited(): LlmFailure {
	return {
		mode: "rate_limited",
		httpStatus: 429,
		rateLimitInfo: {
			resetTimeMs: 1_900_000_000_000,
			retryAfterMs: 600_000, // > RETRY_MAX_DELAY_SECONDS*1000 → retry skipped
		},
	};
}

function failure(mode: LlmFailure["mode"], httpStatus?: number): LlmFailure {
	return httpStatus === undefined ? { mode } : { mode, httpStatus };
}

let guildSeq = 0;

interface MessageHandle {
	message: Message<true>;
	reply: ReturnType<typeof vi.fn>;
	contents: () => string[];
}

function makeMessage(content = `<@${BOT}> hey`): MessageHandle {
	const reply = vi.fn(
		async (_payload: { content: string; allowedMentions?: unknown }) => ({
			id: "reply-msg",
		}),
	);
	const message = {
		guildId: `g${++guildSeq}`,
		channelId: "chan1",
		id: "msg1",
		content,
		author: { displayName: "Mo", id: "user1", username: "mo" },
		member: {},
		client: { user: { id: BOT } },
		channel: {
			isThread: () => false,
			name: "general",
			sendTyping: vi.fn(async () => {}),
			messages: { fetch: vi.fn(async () => null) },
		},
		guild: { members: { me: { roles: { cache: [] } } } },
		react: vi.fn(async () => {}),
		reply,
	};
	return {
		message: message as unknown as Message<true>,
		reply,
		contents: () =>
			reply.mock.calls.map((c) => (c[0] as { content: string }).content),
	};
}

function makeCtx(config: Partial<BotContext["config"]> = {}): BotContext {
	return {
		db: {
			query: { channelRepos: { findFirst: vi.fn(async () => null) } },
		},
		config: {
			CHAT_RATE_PER_MINUTE: 100_000,
			CHAT_MODEL: "claude-haiku-4-5",
			DEFAULT_MODEL: "claude-sonnet-4-6",
			CHAT_FALLBACK_ENABLED: false,
			CHAT_FALLBACK_MODEL: "claude-haiku-4-5",
			RETRY_MAX_DELAY_SECONDS: 5,
			CLASSIFIER_TIMEOUT_SECONDS: 60,
			FREE_TASK_CAP: 15,
			...config,
		},
	} as unknown as BotContext;
}

const replyDecision = {
	ok: true as const,
	decision: { action: "reply" as const, reply_text: "hi" },
};

describe("handleMention orchestration", () => {
	beforeEach(() => {
		// Default happy gates: a guild exists, an anthropic_api_key is connected,
		// and the credential is usable. Individual tests override as needed.
		vi.mocked(ensureGuild).mockResolvedValue({} as never);
		vi.mocked(assertLlmUsable).mockResolvedValue({ ok: true });
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: { type: "anthropic_api_key", token: "sk-test" },
			source: "guild",
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("classify success + reply rate_limited (fallback off): one rate-limit message, never generic (8.1, 8.2, 6.5)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: false,
			failure: rateLimited(),
		});
		const ctx = makeCtx({ CHAT_FALLBACK_ENABLED: false });
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).toHaveBeenCalledTimes(1);
		expect(m.reply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain(RATE_LIMIT_PHRASE);
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("classify rate_limited: posts rate-limit message, reply never generated (8.3)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue({
			ok: false,
			failure: rateLimited(),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).not.toHaveBeenCalled();
		expect(m.reply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain(RATE_LIMIT_PHRASE);
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("classify auth_failed (401): posts auth message, reply never generated (8.4)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue({
			ok: false,
			failure: failure("auth_failed", 401),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).not.toHaveBeenCalled();
		expect(m.reply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain("/connect llm");
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("classify overloaded (529): posts overloaded message, reply never generated (8.4)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue({
			ok: false,
			failure: failure("overloaded", 529),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).not.toHaveBeenCalled();
		expect(m.reply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain("overloaded");
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("classify success + reply auth_failed: posts auth message, not generic (8.5)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: false,
			failure: failure("auth_failed", 401),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain("/connect llm");
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("classify success + reply overloaded: posts overloaded message, not generic (8.5)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: false,
			failure: failure("overloaded", 529),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(m.contents()[0]).toContain("overloaded");
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("classify success + reply model_error: posts model-error message, not generic (8.5)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: false,
			failure: failure("model_error", 400),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(m.contents()[0]).toContain("could not be processed");
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("fallback enabled + requested rate_limited + fallback 200: one extra fallback call + lighter-model notice (6.3, 6.4)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply)
			.mockResolvedValueOnce({ ok: false, failure: rateLimited() })
			.mockResolvedValueOnce({ ok: true, text: "Here is the answer." });
		const ctx = makeCtx({
			CHAT_FALLBACK_ENABLED: true,
			DEFAULT_MODEL: "claude-sonnet-4-6",
			CHAT_FALLBACK_MODEL: "claude-haiku-4-5",
		});
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).toHaveBeenCalledTimes(2);
		// First attempt on the requested model, second on the fallback model.
		expect(vi.mocked(generateChatReply).mock.calls[0]?.[1]).toBe(
			"claude-sonnet-4-6",
		);
		expect(vi.mocked(generateChatReply).mock.calls[1]?.[1]).toBe(
			"claude-haiku-4-5",
		);
		expect(m.reply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain(LIGHTER_NOTICE);
		expect(m.contents()[0]).toContain("Here is the answer.");
		expect(m.contents().join("\n")).not.toContain(RATE_LIMIT_PHRASE);
	});

	it("fallback enabled but non-distinct model: no fallback attempt, rate-limit message, one reply call (6.7)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: false,
			failure: rateLimited(),
		});
		const ctx = makeCtx({
			CHAT_FALLBACK_ENABLED: true,
			DEFAULT_MODEL: "claude-sonnet-4-6",
			CHAT_FALLBACK_MODEL: "claude-sonnet-4-6", // same as DEFAULT → non-distinct
		});
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain(RATE_LIMIT_PHRASE);
		expect(m.contents()[0]).not.toContain(LIGHTER_NOTICE);
	});

	it("fallback disabled + requested rate_limited: rate-limit message, one reply call (6.5)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: false,
			failure: rateLimited(),
		});
		const ctx = makeCtx({ CHAT_FALLBACK_ENABLED: false });
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain(RATE_LIMIT_PHRASE);
		expect(m.contents()[0]).not.toContain(LIGHTER_NOTICE);
	});

	it("fallback enabled + both models rate_limited: rate-limit message, two reply calls (6.6)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply)
			.mockResolvedValueOnce({ ok: false, failure: rateLimited() })
			.mockResolvedValueOnce({ ok: false, failure: rateLimited() });
		const ctx = makeCtx({
			CHAT_FALLBACK_ENABLED: true,
			DEFAULT_MODEL: "claude-sonnet-4-6",
			CHAT_FALLBACK_MODEL: "claude-haiku-4-5",
		});
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(generateChatReply).toHaveBeenCalledTimes(2);
		expect(m.reply).toHaveBeenCalledTimes(1);
		expect(m.contents()[0]).toContain(RATE_LIMIT_PHRASE);
		expect(m.contents()[0]).not.toContain(LIGHTER_NOTICE);
	});

	it("reply success: posts the generated reply (no failure copy)", async () => {
		vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
		vi.mocked(generateChatReply).mockResolvedValue({
			ok: true,
			text: "A normal helpful answer.",
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(m.contents()[0]).toBe("A normal helpful answer.");
		expect(m.contents().join("\n")).not.toContain(GENERIC);
	});

	it("every reply restricts allowed mentions to the replied user only (3.5, 4.7)", async () => {
		// Drive a representative set of branches and assert the invariant holds for
		// every reply() the orchestration emits.
		const scenarios: Array<() => void> = [
			() => {
				vi.mocked(classifyIntent).mockResolvedValue({
					ok: false,
					failure: rateLimited(),
				});
			},
			() => {
				vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
				vi.mocked(generateChatReply).mockResolvedValue({
					ok: false,
					failure: failure("auth_failed", 401),
				});
			},
			() => {
				vi.mocked(classifyIntent).mockResolvedValue(replyDecision);
				vi.mocked(generateChatReply).mockResolvedValue({
					ok: true,
					text: "ok",
				});
			},
		];

		for (const setup of scenarios) {
			vi.clearAllMocks();
			vi.mocked(ensureGuild).mockResolvedValue({} as never);
			vi.mocked(assertLlmUsable).mockResolvedValue({ ok: true });
			vi.mocked(resolveLlmAuth).mockResolvedValue({
				auth: { type: "anthropic_api_key", token: "sk-test" },
				source: "guild",
			});
			setup();
			const m = makeMessage();
			await handleMention(makeCtx(), m.message);
			expect(m.reply).toHaveBeenCalled();
			for (const call of m.reply.mock.calls) {
				expect(
					(call[0] as { allowedMentions: unknown }).allowedMentions,
				).toEqual(SAFE_MENTIONS);
			}
		}
	});

	it("claude_oauth rate-limit message carries the subscription note (provider-aware)", async () => {
		vi.mocked(resolveLlmAuth).mockResolvedValue({
			auth: { type: "claude_oauth", token: "oauth-token" },
			source: "guild",
		});
		vi.mocked(classifyIntent).mockResolvedValue({
			ok: false,
			failure: rateLimited(),
		});
		const ctx = makeCtx();
		const m = makeMessage();

		await handleMention(ctx, m.message);

		expect(m.contents()[0]).toContain(RATE_LIMIT_PHRASE);
		expect(m.contents()[0]).toContain("Subscription credentials");
	});
});
