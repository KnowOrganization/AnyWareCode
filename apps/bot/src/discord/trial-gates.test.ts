import { describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { Guild } from "@anywherecode/db";
import { checkTrialGates, guildCreatedAt } from "./trial-gates.js";

const config = { TRIAL_MIN_SERVER_AGE_DAYS: 30, TRIAL_MIN_HUMAN_MEMBERS: 5 };
const DISCORD_EPOCH_MS = 1_420_070_400_000;

/** Build a snowflake whose embedded timestamp is `date`. */
function snowflakeAt(date: Date): string {
  return String(BigInt(date.getTime() - DISCORD_EPOCH_MS) << 22n);
}

function guildRow(overrides: Partial<Guild> = {}): Guild {
  return {
    id: snowflakeAt(new Date("2020-01-01T00:00:00Z")),
    trialGatesPassedAt: null,
    ...overrides,
  } as Guild;
}

function mockClient(opts: {
  memberCount: number;
  humans?: number;
  fetchFails?: boolean;
  membersFetch?: () => never;
}): { client: Client; membersFetch: ReturnType<typeof vi.fn> } {
  const membersFetch = vi.fn(async () => ({
    filter: (fn: (m: { user: { bot: boolean } }) => boolean) => ({
      size: [
        ...Array(opts.humans ?? 0).fill({ user: { bot: false } }),
        { user: { bot: true } },
      ].filter(fn).length,
    }),
  }));
  const client = {
    guilds: {
      fetch: opts.fetchFails
        ? vi.fn(async () => {
            throw new Error("missing access");
          })
        : vi.fn(async () => ({
            memberCount: opts.memberCount,
            members: { fetch: membersFetch },
          })),
    },
  } as unknown as Client;
  return { client, membersFetch };
}

function mockDb() {
  const mockSet = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
  const db = {
    update: vi.fn(() => ({ set: mockSet })),
  } as unknown as Parameters<typeof checkTrialGates>[1];
  return { db, mockSet };
}

describe("guildCreatedAt", () => {
  it("decodes the timestamp from a snowflake", () => {
    // Example snowflake from the Discord docs.
    expect(guildCreatedAt("175928847299117063").toISOString()).toBe(
      "2016-04-30T11:18:25.796Z",
    );
  });
});

describe("checkTrialGates", () => {
  const now = new Date("2026-06-12T00:00:00Z");

  it("returns ok without any lookups once a pass is cached", async () => {
    const { client } = mockClient({ memberCount: 1 });
    const { db } = mockDb();
    const res = await checkTrialGates(
      client,
      db,
      config,
      guildRow({ trialGatesPassedAt: new Date() }),
      now,
    );
    expect(res.ok).toBe(true);
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });

  it("blocks servers younger than the minimum age", async () => {
    const { client } = mockClient({ memberCount: 50, humans: 50 });
    const { db, mockSet } = mockDb();
    const young = guildRow({
      id: snowflakeAt(new Date("2026-06-01T00:00:00Z")),
    });
    const res = await checkTrialGates(client, db, config, young, now);
    expect(res).toMatchObject({ ok: false });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("blocks servers with too few human members (bots don't count)", async () => {
    const { client } = mockClient({ memberCount: 10, humans: 3 });
    const { db } = mockDb();
    const res = await checkTrialGates(client, db, config, guildRow(), now);
    expect(res).toMatchObject({ ok: false });
  });

  it("passes and stamps trialGatesPassedAt", async () => {
    const { client } = mockClient({ memberCount: 10, humans: 9 });
    const { db, mockSet } = mockDb();
    const res = await checkTrialGates(client, db, config, guildRow(), now);
    expect(res.ok).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ trialGatesPassedAt: now }),
    );
  });

  it("skips the full member fetch on big servers", async () => {
    const { client, membersFetch } = mockClient({ memberCount: 5000 });
    const { db } = mockDb();
    const res = await checkTrialGates(client, db, config, guildRow(), now);
    expect(res.ok).toBe(true);
    expect(membersFetch).not.toHaveBeenCalled();
  });

  it("fails open when the member lookup errors", async () => {
    const { client } = mockClient({ memberCount: 10, fetchFails: true });
    const { db } = mockDb();
    const res = await checkTrialGates(client, db, config, guildRow(), now);
    expect(res.ok).toBe(true);
  });
});
