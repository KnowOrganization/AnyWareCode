import { describe, expect, it, vi } from "vitest";
import { recordTaskPackPurchase } from "@anywarecode/db";
import { bumpUsage, claimUnits, refundUsage } from "./usage.js";

/**
 * Drizzle-shaped mock covering both surfaces: update().set().where() chains
 * (recorded in `sets`) and the claimUnits transaction (select…for("update")
 * resolving the supplied guild counters).
 */
function mockDb(
  guild: {
    taskCap: number;
    tasksUsedThisMonth: number;
    packTasksRemaining: number;
  } | null = null,
) {
  const sets: Record<string, unknown>[] = [];
  const update = vi.fn(() => ({
    set: (payload: Record<string, unknown>) => {
      sets.push(payload);
      return { where: () => Promise.resolve() };
    },
  }));
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => Promise.resolve(guild ? [guild] : []),
        }),
      }),
    }),
    update,
  };
  const db = {
    update,
    transaction: <T>(cb: (t: typeof tx) => Promise<T>) => cb(tx),
  } as unknown as Parameters<typeof bumpUsage>[0];
  return { db, update, sets };
}

describe("claimUnits", () => {
  it("claims all from the plan bucket when it has room", async () => {
    const { db, sets } = mockDb({ taskCap: 10, tasksUsedThisMonth: 5, packTasksRemaining: 0 });
    expect(await claimUnits(db, "g1", 3)).toEqual(["plan", "plan", "plan"]);
    expect(sets[0]).toMatchObject({ tasksUsedThisMonth: 8, packTasksRemaining: 0 });
  });

  it("splits plan + pack across the boundary", async () => {
    const { db, sets } = mockDb({ taskCap: 10, tasksUsedThisMonth: 9, packTasksRemaining: 5 });
    expect(await claimUnits(db, "g1", 3)).toEqual(["plan", "pack", "pack"]);
    expect(sets[0]).toMatchObject({ tasksUsedThisMonth: 10, packTasksRemaining: 3 });
  });

  it("is all-or-nothing on shortfall — no partial spend, no free units", async () => {
    const { db, update } = mockDb({ taskCap: 10, tasksUsedThisMonth: 10, packTasksRemaining: 1 });
    expect(await claimUnits(db, "g1", 2)).toBeNull();
    expect(update).not.toHaveBeenCalled();
    // The old bug: both buckets dry still "succeeded". Now: null.
    const dry = mockDb({ taskCap: 10, tasksUsedThisMonth: 10, packTasksRemaining: 0 });
    expect(await claimUnits(dry.db, "g1", 1)).toBeNull();
  });

  it("handles a missing guild and n=0", async () => {
    const { db } = mockDb(null);
    expect(await claimUnits(db, "g1", 1)).toBeNull();
    expect(await claimUnits(db, "g1", 0)).toEqual([]);
  });
});

describe("bumpUsage", () => {
  it("charges the plan bucket while under cap", async () => {
    const { db } = mockDb({ taskCap: 10, tasksUsedThisMonth: 0, packTasksRemaining: 0 });
    expect(await bumpUsage(db, "g1", "code")).toBe("plan");
  });

  it("falls back to the pack bucket once the plan cap is full", async () => {
    const { db } = mockDb({ taskCap: 10, tasksUsedThisMonth: 10, packTasksRemaining: 2 });
    expect(await bumpUsage(db, "g1", "code")).toBe("pack");
  });

  it("races past a dry guild as refundable plan overage, never a free pack", async () => {
    const { db, sets } = mockDb({ taskCap: 10, tasksUsedThisMonth: 10, packTasksRemaining: 0 });
    expect(await bumpUsage(db, "g1", "code")).toBe("plan");
    expect(Object.keys(sets.at(-1) ?? {})).toEqual(["tasksUsedThisMonth"]);
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
    razorpayPaymentId: "pay_1",
  };

  it("credits the balance on first insert", async () => {
    const { db, update } = mockTxDb([{ id: "p1" }]);
    expect(await recordTaskPackPurchase(db, row)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a replayed payment id", async () => {
    const { db, update } = mockTxDb([]);
    expect(await recordTaskPackPurchase(db, row)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
