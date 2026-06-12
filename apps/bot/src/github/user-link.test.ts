import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import {
  consumeUserLinkState,
  createUserLinkState,
  exchangeCodeForLogin,
} from "./user-link.js";

const SECRET = "test-secret-test-secret";

/** One-row-at-a-time state store: delete pops the pending row (single-use). */
function mockStateDb() {
  const rows: Array<{ nonce: string; guildId: string; expiresAt: Date }> = [];
  const db = {
    insert: () => ({
      values: (v: { nonce: string; guildId: string; expiresAt: Date }) => {
        rows.push(v);
        return Promise.resolve();
      },
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          const row = rows.shift();
          return Promise.resolve(row ? [row] : []);
        },
      }),
    }),
  } as unknown as Parameters<typeof createUserLinkState>[0];
  return { db, rows };
}

describe("user link state", () => {
  it("round-trips and is single-use", async () => {
    const { db } = mockStateDb();
    const state = await createUserLinkState(db, SECRET, "u123", 10);
    expect(await consumeUserLinkState(db, SECRET, state)).toBe("u123");
    // Replay: the row is gone.
    expect(await consumeUserLinkState(db, SECRET, state)).toBeNull();
  });

  it("rejects forged and wrong-secret states", async () => {
    const { db } = mockStateDb();
    await createUserLinkState(db, SECRET, "u123", 10);
    expect(await consumeUserLinkState(db, SECRET, "forged.state")).toBeNull();
    const state2 = await createUserLinkState(db, SECRET, "u123", 10);
    expect(await consumeUserLinkState(db, "other-secret-other-sec", state2)).toBeNull();
  });
});

describe("exchangeCodeForLogin", () => {
  const config = {
    GITHUB_CLIENT_ID: "cid",
    GITHUB_CLIENT_SECRET: "csec",
  } as Config;

  it("exchanges the code, fetches the login, and never stores the token", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("access_token")) {
        return new Response(JSON.stringify({ access_token: "gho_secret" }), { status: 200 });
      }
      return new Response(JSON.stringify({ login: "octocat" }), { status: 200 });
    });
    expect(await exchangeCodeForLogin(config, "code123", fetchFn)).toBe("octocat");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns null on any failure", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 401 }));
    expect(await exchangeCodeForLogin(config, "bad", failing)).toBeNull();
  });
});
