import { describe, expect, it, vi } from "vitest";
import {
  adjustPackTasks,
  adminSetGuildBilling,
  applyGuildSubscription,
  writeAudit,
} from "./index.js";

/** Mock just the update().set().where() chain + a guild read for guards. */
function mockDb(currentSubSource: string | null = "razorpay") {
  const sets: Record<string, unknown>[] = [];
  const update = vi.fn(() => ({
    set: (payload: Record<string, unknown>) => {
      sets.push(payload);
      return { where: () => Promise.resolve() };
    },
  }));
  const insertValues: Record<string, unknown>[] = [];
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      insertValues.push(v);
      return Promise.resolve();
    },
  }));
  const db = {
    update,
    insert,
    query: {
      guilds: {
        findFirst: () => Promise.resolve({ subSource: currentSubSource }),
      },
    },
  } as never;
  return { db, update, insert, sets, insertValues };
}

describe("adminSetGuildBilling", () => {
  it("forces subSource=admin when a billing field changes + mirrors cap", async () => {
    const { db, sets } = mockDb();
    await adminSetGuildBilling(db, "g1", {
      planId: "pro",
      subStatus: "active",
      taskCap: 100,
      concurrency: 2,
    });
    expect(sets[0]).toMatchObject({
      planId: "pro",
      subStatus: "active",
      taskCap: 100,
      concurrency: 2,
      subSource: "admin",
    });
  });

  it("resetUsage zeros the monthly counters", async () => {
    const { db, sets } = mockDb();
    await adminSetGuildBilling(db, "g1", { resetUsage: true });
    expect(sets[0]).toMatchObject({
      tasksUsedThisMonth: 0,
      asksUsedThisMonth: 0,
    });
    // No billing field touched → subSource not forced.
    expect(sets[0]).not.toHaveProperty("subSource");
  });

  it("clamps packTasksRemaining at 0", async () => {
    const { db, sets } = mockDb();
    await adminSetGuildBilling(db, "g1", { packTasksRemaining: -5 });
    expect(sets[0]).toMatchObject({ packTasksRemaining: 0 });
  });
});

describe("applyGuildSubscription onlyIfSource guard", () => {
  it("skips the write when the guild is admin-owned", async () => {
    const { db, update } = mockDb("admin");
    await applyGuildSubscription(
      db,
      "g1",
      { subStatus: "canceled" },
      { onlyIfSource: ["razorpay", null] },
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("writes when the source matches", async () => {
    const { db, update } = mockDb("razorpay");
    await applyGuildSubscription(
      db,
      "g1",
      { subStatus: "canceled" },
      { onlyIfSource: ["razorpay", null] },
    );
    expect(update).toHaveBeenCalled();
  });
});

describe("adjustPackTasks", () => {
  it("issues a greatest(0, ...) clamp update", async () => {
    const { db, sets } = mockDb();
    await adjustPackTasks(db, "g1", -10);
    expect(sets[0]).toHaveProperty("packTasksRemaining");
    expect(sets[0]).toHaveProperty("updatedAt");
  });
});

describe("writeAudit", () => {
  it("inserts an audit row with before/after defaulted to null", async () => {
    const { db, insertValues } = mockDb();
    await writeAudit(db, {
      actorDiscordId: "123",
      action: "guild.setTier",
      targetType: "guild",
      targetId: "g1",
    });
    expect(insertValues[0]).toMatchObject({
      actorDiscordId: "123",
      action: "guild.setTier",
      targetType: "guild",
      targetId: "g1",
      before: null,
      after: null,
    });
  });
});
