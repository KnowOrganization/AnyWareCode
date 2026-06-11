import { describe, expect, it } from "vitest";
import {
  ChatRateLimiter,
  isBotMentioned,
  routeMessage,
  stripBotMention,
} from "./mentions.js";

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
    expect(isBotMentioned(`<@&${ROLE}> look at this`, BOT, [ROLE])).toBe(true);
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
    [
      { ...base, isThread: true, hasActiveTask: true },
      { kind: "forward" },
    ],
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
