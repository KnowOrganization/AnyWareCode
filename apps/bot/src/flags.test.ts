import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFlagCache, isClaudeOauthEnabled } from "./flags.js";

function mockDb(value: unknown) {
  const findFirst = vi.fn(async () =>
    value === undefined ? undefined : { key: "claude_oauth_enabled", value },
  );
  const db = {
    query: { appSettings: { findFirst } },
  } as unknown as Parameters<typeof isClaudeOauthEnabled>[0];
  return { db, findFirst };
}

afterEach(() => clearFlagCache());

describe("isClaudeOauthEnabled", () => {
  it("defaults to enabled when no row exists", async () => {
    const { db } = mockDb(undefined);
    expect(await isClaudeOauthEnabled(db)).toBe(true);
  });

  it("honors a stored kill switch", async () => {
    const { db } = mockDb(false);
    expect(await isClaudeOauthEnabled(db)).toBe(false);
  });

  it("ignores non-boolean garbage in the setting", async () => {
    const { db } = mockDb("nope");
    expect(await isClaudeOauthEnabled(db)).toBe(true);
  });

  it("caches reads within the TTL and re-reads after clearing", async () => {
    const off = mockDb(false);
    expect(await isClaudeOauthEnabled(off.db)).toBe(false);
    // Underlying value flips, but the cache still answers.
    const on = mockDb(true);
    expect(await isClaudeOauthEnabled(on.db)).toBe(false);
    expect(on.findFirst).not.toHaveBeenCalled();
    clearFlagCache();
    expect(await isClaudeOauthEnabled(on.db)).toBe(true);
  });

  it("fails open when the read throws", async () => {
    const db = {
      query: {
        appSettings: {
          findFirst: vi.fn(async () => {
            throw new Error("db down");
          }),
        },
      },
    } as unknown as Parameters<typeof isClaudeOauthEnabled>[0];
    expect(await isClaudeOauthEnabled(db)).toBe(true);
  });
});
