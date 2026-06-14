import { describe, expect, it, vi } from "vitest";
import type { Guild } from "@anywarecode/db";
import {
  capState,
  ensureGuild,
  nextMonthStart,
  packSpendable,
  planSummary,
  resolveTier,
} from "./gates.js";

function guildRow(overrides: Partial<Guild> = {}): Guild {
  return {
    id: "g1",
    allowedRoleId: null,
    taskCap: 15,
    concurrency: 1,
    packTasksRemaining: 0,
    tasksUsedThisMonth: 0,
    asksUsedThisMonth: 0,
    capResetAt: new Date("2099-01-01T00:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
    planId: "free",
    razorpayCustomerId: null,
    razorpaySubscriptionId: null,
    subStatus: "free",
    subSource: null,
    requireLinkedSponsor: false,
    currentPeriodEnd: null,
    ossStatus: "none",
    ossAppliedAt: null,
    ossReviewedAt: null,
    suspended: false,
    shiplogChannelId: null,
    planVoteMode: "instant",
    planVoteRoleId: null,
    llmProviderType: null,
    llmCredentialEnc: null,
    llmBaseUrl: null,
    llmModel: null,
    llmCredentialSetAt: null,
    ...overrides,
  };
}

describe("resolveTier", () => {
  it("defaults every guild to the Free floor", () => {
    expect(resolveTier(guildRow({ subStatus: "free", planId: "free" }))).toEqual(
      { kind: "free" },
    );
    expect(resolveTier(guildRow({ subStatus: "free", planId: null }))).toEqual({
      kind: "free",
    });
    // A canceled paid plan falls back to Free, never to nothing.
    expect(
      resolveTier(guildRow({ subStatus: "canceled", planId: "pro" })),
    ).toEqual({ kind: "free" });
  });

  it("maps approved OSS and active/past_due paid plans", () => {
    expect(
      resolveTier(
        guildRow({ subStatus: "free", planId: "oss", ossStatus: "approved" }),
      ),
    ).toEqual({ kind: "oss" });
    expect(
      resolveTier(guildRow({ subStatus: "active", planId: "pro" })),
    ).toEqual({ kind: "paid", planId: "pro" });
    expect(
      resolveTier(guildRow({ subStatus: "past_due", planId: "studio" })),
    ).toEqual({ kind: "paid", planId: "studio" });
  });

  it("requires OSS approval and a live subscription, else Free", () => {
    expect(
      resolveTier(
        guildRow({ subStatus: "free", planId: "oss", ossStatus: "pending" }),
      ),
    ).toEqual({ kind: "free" });
    // Canceled OSS grant also drops to Free.
    expect(
      resolveTier(
        guildRow({ subStatus: "canceled", planId: "oss", ossStatus: "approved" }),
      ),
    ).toEqual({ kind: "free" });
  });
});

describe("capState", () => {
  it("allows under the /code cap and blocks at it", () => {
    expect(capState(guildRow({ tasksUsedThisMonth: 14 }), "code").exceeded).toBe(
      false,
    );
    expect(
      capState(guildRow({ tasksUsedThisMonth: 15 }), "code").exceeded,
    ).toBe(true);
  });

  it("gives /ask unlimited capacity on every tier", () => {
    for (const guild of [
      guildRow({ planId: "free", asksUsedThisMonth: 9999 }),
      guildRow({ planId: "pro", subStatus: "active", asksUsedThisMonth: 9999 }),
      guildRow({
        planId: "oss",
        subStatus: "free",
        ossStatus: "approved",
        asksUsedThisMonth: 9999,
      }),
    ]) {
      expect(capState(guild, "ask")).toMatchObject({
        exceeded: false,
        unlimited: true,
        cap: Number.POSITIVE_INFINITY,
      });
    }
  });

  it("treats an overdue reset as a fresh month", () => {
    const guild = guildRow({
      tasksUsedThisMonth: 15,
      capResetAt: new Date("2020-01-01T00:00:00Z"),
    });
    const state = capState(guild, "code", new Date("2020-02-15T00:00:00Z"));
    expect(state).toMatchObject({ exceeded: false, used: 0, needsReset: true });
  });

  it("falls back to pack tasks once the /code cap is exhausted — on every tier", () => {
    for (const planId of ["free", "pro"]) {
      const guild = guildRow({
        planId,
        subStatus: planId === "pro" ? "active" : "free",
        tasksUsedThisMonth: 15,
        packTasksRemaining: 3,
      });
      expect(capState(guild, "code")).toMatchObject({
        exceeded: false,
        packRemaining: 3,
      });
    }
  });

  it("packs never fund /ask (and /ask is unlimited anyway)", () => {
    const guild = guildRow({
      planId: "pro",
      subStatus: "active",
      asksUsedThisMonth: 9999,
      packTasksRemaining: 3,
    });
    expect(capState(guild, "ask")).toMatchObject({
      exceeded: false,
      unlimited: true,
      packRemaining: 0,
    });
  });
});

describe("packSpendable", () => {
  it("is true on every tier (all tiers are entitled)", () => {
    expect(packSpendable(guildRow({ subStatus: "free" }))).toBe(true);
    expect(packSpendable(guildRow({ subStatus: "active", planId: "pro" }))).toBe(
      true,
    );
    expect(packSpendable(guildRow({ subStatus: "canceled" }))).toBe(true);
  });
});

describe("planSummary", () => {
  it("labels the Free floor", () => {
    const s = planSummary(guildRow({ subStatus: "free", planId: "free" }));
    expect(s.tier).toBe("Free");
    expect(s.askCap).toBe(Number.POSITIVE_INFINITY);
  });

  it("labels paid tiers from the plan row, flagging overdue payment", () => {
    const pro = planSummary(
      guildRow({ subStatus: "active", planId: "pro", taskCap: 150 }),
    );
    expect(pro.tier).toBe("Pro");
    expect(pro.codeCap).toBe(150);
    expect(pro.askCap).toBe(Number.POSITIVE_INFINITY);
    const overdue = planSummary(
      guildRow({ subStatus: "past_due", planId: "studio" }),
    );
    expect(overdue.tier).toBe("Studio (payment overdue)");
  });

  it("shows canceled paid guilds as Free", () => {
    expect(
      planSummary(guildRow({ subStatus: "canceled", planId: "pro" })).tier,
    ).toBe("Free");
  });

  it("surfaces the pack balance and the OSS label", () => {
    const s = planSummary(
      guildRow({
        subStatus: "free",
        planId: "oss",
        ossStatus: "approved",
        packTasksRemaining: 12,
      }),
    );
    expect(s.tier).toBe("OSS Community");
    expect(s.packRemaining).toBe(12);
    expect(s.askCap).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("ensureGuild", () => {
  const config = { FREE_TASK_CAP: 15 };

  function mockUpdateDb(existing: Guild) {
    const mockReturning = vi.fn().mockResolvedValue([existing]);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn((_updates: Record<string, unknown>) => ({
      where: mockWhere,
    }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));
    const db = {
      update: mockUpdate,
      query: { guilds: { findFirst: vi.fn().mockResolvedValue(existing) } },
    } as unknown as Parameters<typeof ensureGuild>[0];
    return { db, mockSet, mockUpdate };
  }

  it("creates new guilds on the Free plan", async () => {
    const created = guildRow();
    const mockReturning = vi.fn().mockResolvedValue([created]);
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const db = {
      insert: mockInsert,
      query: { guilds: { findFirst: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as Parameters<typeof ensureGuild>[0];
    await ensureGuild(db, "g1", config, new Date("2026-02-01T00:00:00Z"));
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "free",
        taskCap: 15,
        concurrency: 1,
        subStatus: "free",
      }),
    );
  });

  it("normalizes a canceled paid guild onto the Free floor", async () => {
    const { db, mockSet } = mockUpdateDb(
      guildRow({ subStatus: "canceled", planId: "pro", taskCap: 0, concurrency: 2 }),
    );
    await ensureGuild(db, "g1", config, new Date("2026-02-01T00:00:00Z"));
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: "free",
        subStatus: "free",
        taskCap: 15,
        concurrency: 1,
      }),
    );
  });

  it("leaves an active paid plan untouched", async () => {
    const { db, mockUpdate } = mockUpdateDb(
      guildRow({ subStatus: "active", planId: "pro", taskCap: 150, concurrency: 2 }),
    );
    await ensureGuild(db, "g1", config, new Date("2026-02-01T00:00:00Z"));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("monthly reset clears counters but not the pack balance", async () => {
    const { db, mockSet } = mockUpdateDb(
      guildRow({
        capResetAt: new Date("2026-01-01T00:00:00Z"),
        tasksUsedThisMonth: 7,
        packTasksRemaining: 5,
      }),
    );
    await ensureGuild(db, "g1", config, new Date("2026-02-15T00:00:00Z"));
    const updates = mockSet.mock.calls[0]?.[0] ?? {};
    expect(updates).toMatchObject({ tasksUsedThisMonth: 0, asksUsedThisMonth: 0 });
    expect(updates).not.toHaveProperty("packTasksRemaining");
  });
});

describe("nextMonthStart", () => {
  it("rolls to the first of the next month (UTC)", () => {
    expect(nextMonthStart(new Date("2026-06-10T12:00:00Z")).toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(nextMonthStart(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});
