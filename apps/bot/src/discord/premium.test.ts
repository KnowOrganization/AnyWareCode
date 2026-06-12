import { describe, expect, it, vi } from "vitest";
import type { Entitlement } from "discord.js";
import type { Config } from "../config.js";
import { applyEntitlement, revokeEntitlement } from "./premium.js";

const config = {
  DISCORD_SKU_PRO: "sku_pro",
  DISCORD_SKU_STUDIO: "sku_studio",
  DISCORD_SKU_PACK: "sku_pack",
} as Config;

function entitlement(overrides: Partial<Record<string, unknown>> = {}): Entitlement {
  return {
    id: "ent1",
    guildId: "g1",
    userId: "u1",
    skuId: "sku_pro",
    consumed: false,
    endsAt: new Date("2026-07-12T00:00:00Z"),
    isTest: () => false,
    fetchUser: async () => ({ username: "mo" }),
    ...overrides,
  } as unknown as Entitlement;
}

function mockDb(opts: {
  guild?: { subSource: string | null; subStatus?: string };
  ledger?: { tasks: number } | null;
  packInsertConflict?: boolean;
} = {}) {
  const sets: Record<string, unknown>[] = [];
  const update = vi.fn(() => ({
    set: (payload: Record<string, unknown>) => {
      sets.push(payload);
      return { where: () => Promise.resolve() };
    },
  }));
  const tx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => (opts.packInsertConflict ? [] : [{ id: "p" }]),
        }),
      }),
    }),
    update,
  };
  const db = {
    update,
    transaction: <T>(cb: (t: typeof tx) => Promise<T>) => cb(tx),
    query: {
      guilds: { findFirst: vi.fn(async () => opts.guild ?? null) },
      plans: {
        findFirst: vi.fn(async () => ({
          id: "pro",
          taskCap: 100,
          concurrency: 2,
          features: [],
        })),
      },
      taskPackPurchases: {
        findFirst: vi.fn(async () => opts.ledger ?? null),
      },
    },
  } as unknown as Parameters<typeof applyEntitlement>[0]["db"];
  return { db, update, sets };
}

function mockClient(consume = vi.fn(async () => {})) {
  return {
    client: {
      application: { entitlements: { consume } },
    } as unknown as Parameters<typeof applyEntitlement>[0]["client"],
    consume,
  };
}

describe("applyEntitlement", () => {
  it("maps a subscription SKU onto the guild's billing columns", async () => {
    const { db, sets } = mockDb();
    const { client } = mockClient();
    await applyEntitlement({ db, config, client }, entitlement());
    expect(sets[0]).toMatchObject({
      subStatus: "active",
      subSource: "discord",
      planId: "pro",
      taskCap: 100,
      concurrency: 2,
    });
  });

  it("ignores user-scoped entitlements", async () => {
    const { db, update } = mockDb();
    const { client } = mockClient();
    await applyEntitlement({ db, config, client }, entitlement({ guildId: null }));
    expect(update).not.toHaveBeenCalled();
  });

  it("credits a pack then consumes — and a replay never double-credits", async () => {
    const { db, sets } = mockDb();
    const { client, consume } = mockClient();
    await applyEntitlement(
      { db, config, client },
      entitlement({ skuId: "sku_pack" }),
    );
    expect(sets[0]).toHaveProperty("packTasksRemaining");
    expect(consume).toHaveBeenCalledWith("ent1");

    // Replay: ledger insert conflicts, balance untouched, consume retried.
    const replay = mockDb({ packInsertConflict: true });
    const second = mockClient();
    await applyEntitlement(
      { db: replay.db, config, client: second.client },
      entitlement({ skuId: "sku_pack" }),
    );
    expect(replay.sets).toHaveLength(0);
    expect(second.consume).toHaveBeenCalled();
  });
});

describe("revokeEntitlement", () => {
  it("pack refund claws back the ledger amount, never the subscription", async () => {
    const { db, sets } = mockDb({ ledger: { tasks: 50 } });
    await revokeEntitlement({ db, config }, entitlement({ skuId: "sku_pack" }));
    expect(Object.keys(sets[0] ?? {})).toEqual(["packTasksRemaining"]);
  });

  it("sub delete cancels only a Discord-funded plan (source guard)", async () => {
    const stripeFunded = mockDb({ guild: { subSource: "stripe" } });
    await revokeEntitlement({ db: stripeFunded.db, config }, entitlement());
    expect(stripeFunded.update).not.toHaveBeenCalled();

    const discordFunded = mockDb({ guild: { subSource: "discord" } });
    await revokeEntitlement({ db: discordFunded.db, config }, entitlement());
    expect(discordFunded.sets[0]).toMatchObject({
      subStatus: "canceled",
      taskCap: 0,
      concurrency: 1,
    });
  });
});
