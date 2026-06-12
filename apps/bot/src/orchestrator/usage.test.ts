import { describe, expect, it, vi } from "vitest";
import { recordTaskPackPurchase } from "@anywherecode/db";
import { bumpUsage, refundUsage } from "./usage.js";

/** Drizzle-shaped update mock; records each set() payload, returning() pops
 * from the supplied claim-result queue. */
function mockDb(claims: Array<Array<{ id: string }>> = []) {
  const sets: Record<string, unknown>[] = [];
  const update = vi.fn(() => ({
    set: (payload: Record<string, unknown>) => {
      sets.push(payload);
      return {
        where: () => ({
          returning: () => Promise.resolve(claims.shift() ?? []),
        }),
      };
    },
  }));
  const db = { update } as unknown as Parameters<typeof bumpUsage>[0];
  return { db, update, sets };
}

describe("bumpUsage", () => {
  it("charges the plan bucket while under cap", async () => {
    const { db, update, sets } = mockDb([[{ id: "g1" }]]);
    expect(await bumpUsage(db, "g1", "code")).toBe("plan");
    expect(update).toHaveBeenCalledTimes(1);
    expect(Object.keys(sets[0] ?? {})).toEqual(["tasksUsedThisMonth"]);
  });

  it("falls back to the pack bucket once the plan claim fails", async () => {
    const { db, update, sets } = mockDb([[]]);
    expect(await bumpUsage(db, "g1", "code")).toBe("pack");
    expect(update).toHaveBeenCalledTimes(2);
    expect(Object.keys(sets[1] ?? {})).toEqual(["packTasksRemaining"]);
  });

  it("asks always charge the plan bucket", async () => {
    const { db, sets } = mockDb();
    expect(await bumpUsage(db, "g1", "ask")).toBe("plan");
    expect(Object.keys(sets[0] ?? {})).toEqual(["asksUsedThisMonth"]);
  });
});

describe("refundUsage", () => {
  it("reverses the bucket the task was funded from", async () => {
    const plan = mockDb();
    await refundUsage(plan.db, "g1", "code", "plan");
    expect(Object.keys(plan.sets[0] ?? {})).toEqual(["tasksUsedThisMonth"]);

    const pack = mockDb();
    await refundUsage(pack.db, "g1", "code", "pack");
    expect(Object.keys(pack.sets[0] ?? {})).toEqual(["packTasksRemaining"]);

    const ask = mockDb();
    await refundUsage(ask.db, "g1", "ask");
    expect(Object.keys(ask.sets[0] ?? {})).toEqual(["asksUsedThisMonth"]);
  });
});

describe("recordTaskPackPurchase", () => {
  function mockTxDb(inserted: Array<{ id: string }>) {
    const update = vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve() }),
    }));
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(inserted),
          }),
        }),
      }),
      update,
    };
    const db = {
      transaction: (cb: (t: typeof tx) => Promise<boolean>) => cb(tx),
    } as unknown as Parameters<typeof recordTaskPackPurchase>[0];
    return { db, update };
  }

  const row = {
    id: "p1",
    guildId: "g1",
    purchasedBy: "u1",
    purchaserName: "mo",
    tasks: 50,
    amountCents: 1000,
    stripeCheckoutSessionId: "cs_1",
  };

  it("credits the balance on first insert", async () => {
    const { db, update } = mockTxDb([{ id: "p1" }]);
    expect(await recordTaskPackPurchase(db, row)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a replayed Stripe session", async () => {
    const { db, update } = mockTxDb([]);
    expect(await recordTaskPackPurchase(db, row)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
