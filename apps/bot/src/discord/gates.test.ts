import { describe, expect, it, vi } from "vitest";
import type { Guild } from "@anywherecode/db";
import {
  allowPlatformKey,
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
    taskCap: 10,
    concurrency: 1,
    packTasksRemaining: 0,
    tasksUsedThisMonth: 0,
    asksUsedThisMonth: 0,
    capResetAt: new Date("2099-01-01T00:00:00Z"),
    createdAt: new Date(),
    planId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subStatus: "active",
    subSource: null,
    requireLinkedSponsor: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    ossStatus: "none",
    ossAppliedAt: null,
    ossReviewedAt: null,
    suspended: false,
    trialGatesPassedAt: null,
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
  it("maps subscription state to a single tier", () => {
    expect(resolveTier(guildRow({ subStatus: "trialing" }))).toEqual({
      kind: "trial",
    });
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
    expect(resolveTier(guildRow({ subStatus: "canceled" }))).toEqual({
      kind: "none",
      reason: "canceled",
    });
    expect(resolveTier(guildRow({ subStatus: "free" }))).toEqual({
      kind: "none",
      reason: "trial_expired",
    });
  });

  it("requires OSS approval, not just the plan id", () => {
    expect(
      resolveTier(
        guildRow({ subStatus: "free", planId: "oss", ossStatus: "pending" }),
      ),
    ).toEqual({ kind: "none", reason: "trial_expired" });
  });
});

describe("capState", () => {
  it("allows under the cap and blocks at it", () => {
    expect(capState(guildRow({ tasksUsedThisMonth: 9 }), "code").exceeded).toBe(
      false,
    );
    expect(
      capState(guildRow({ tasksUsedThisMonth: 10 }), "code").exceeded,
    ).toBe(true);
  });

  it("gives /ask a looser, separate cap", () => {
    const guild = guildRow({ tasksUsedThisMonth: 10, asksUsedThisMonth: 39 });
    expect(capState(guild, "ask")).toMatchObject({
      exceeded: false,
      cap: 40,
      used: 39,
    });
  });

  it("treats an overdue reset as a fresh month", () => {
    const guild = guildRow({
      tasksUsedThisMonth: 10,
      capResetAt: new Date("2020-01-01T00:00:00Z"),
    });
    const state = capState(guild, "code", new Date("2020-02-15T00:00:00Z"));
    expect(state).toMatchObject({ exceeded: false, used: 0, needsReset: true });
  });

  it("falls back to pack tasks once the plan cap is exhausted (paid tier)", () => {
    const guild = guildRow({
      planId: "pro",
      tasksUsedThisMonth: 10,
      packTasksRemaining: 3,
    });
    expect(capState(guild, "code")).toMatchObject({
      exceeded: false,
      packRemaining: 3,
    });
  });

  it("never spends packs during trial or without a plan", () => {
    const trial = guildRow({
      subStatus: "trialing",
      tasksUsedThisMonth: 10,
      packTasksRemaining: 3,
    });
    expect(capState(trial, "code")).toMatchObject({
      exceeded: true,
      packRemaining: 0,
    });
    const none = guildRow({
      subStatus: "free",
      tasksUsedThisMonth: 10,
      packTasksRemaining: 3,
    });
    expect(capState(none, "code").exceeded).toBe(true);
    expect(packSpendable(trial)).toBe(false);
    expect(packSpendable(none)).toBe(false);
  });

  it("packs never fund /ask", () => {
    const guild = guildRow({
      planId: "pro",
      asksUsedThisMonth: 40,
      packTasksRemaining: 3,
    });
    expect(capState(guild, "ask")).toMatchObject({
      exceeded: true,
      packRemaining: 0,
    });
  });

  it("gives the OSS tier unlimited /ask but a capped /code", () => {
    const guild = guildRow({
      subStatus: "free",
      planId: "oss",
      ossStatus: "approved",
      taskCap: 30,
      tasksUsedThisMonth: 30,
      asksUsedThisMonth: 9999,
    });
    expect(capState(guild, "ask")).toMatchObject({
      exceeded: false,
      unlimited: true,
    });
    expect(capState(guild, "code").exceeded).toBe(true);
  });
});

describe("allowPlatformKey", () => {
  it("allows only while trialing", () => {
    expect(allowPlatformKey(guildRow({ subStatus: "trialing" }))).toBe(true);
    expect(allowPlatformKey(guildRow({ subStatus: "active" }))).toBe(false);
    expect(allowPlatformKey(guildRow({ subStatus: "free" }))).toBe(false);
    expect(allowPlatformKey(guildRow({ subStatus: "past_due" }))).toBe(false);
  });
});

describe("planSummary", () => {
  it("reports trial days left while trialing", () => {
    const now = new Date("2026-06-11T00:00:00Z");
    const s = planSummary(
      guildRow({
        subStatus: "trialing",
        trialEndsAt: new Date("2026-06-16T00:00:00Z"),
      }),
      now,
    );
    expect(s.tier).toBe("Trial");
    expect(s.trialDaysLeft).toBe(5);
  });

  it("labels paid tiers from the plan row, flagging overdue payment", () => {
    const pro = planSummary(
      guildRow({ subStatus: "active", planId: "pro", taskCap: 100 }),
    );
    expect(pro.tier).toBe("Pro");
    expect(pro.codeCap).toBe(100);
    expect(pro.askCap).toBe(400);
    expect(pro.trialDaysLeft).toBeNull();
    const overdue = planSummary(
      guildRow({ subStatus: "past_due", planId: "studio" }),
    );
    expect(overdue.tier).toBe("Studio (payment overdue)");
  });

  it("labels post-trial guilds without a plan", () => {
    expect(planSummary(guildRow({ subStatus: "free" })).tier).toBe("No plan");
    expect(planSummary(guildRow({ subStatus: "canceled" })).tier).toBe(
      "Canceled",
    );
  });

  it("surfaces the pack balance and OSS unlimited /ask", () => {
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

  it("clamps an elapsed trial to zero days", () => {
    const s = planSummary(
      guildRow({
        subStatus: "trialing",
        trialEndsAt: new Date("2020-01-01T00:00:00Z"),
      }),
      new Date("2026-06-11T00:00:00Z"),
    );
    expect(s.trialDaysLeft).toBe(0);
  });
});

describe("ensureGuild trial expiry", () => {
  const config = { TRIAL_DAYS: 14, PLATFORM_TRIAL_TASK_CAP: 10 };

  function mockDb(existing: Guild) {
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

  it("strips entitlements when the trial elapses without a plan", async () => {
    const { db, mockSet } = mockDb(
      guildRow({
        subStatus: "trialing",
        trialEndsAt: new Date("2026-01-01T00:00:00Z"),
        planId: null,
      }),
    );
    await ensureGuild(db, "g1", config, new Date("2026-02-01T00:00:00Z"));
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ subStatus: "free", taskCap: 0, concurrency: 1 }),
    );
  });

  it("never clobbers a plan that landed mid-trial", async () => {
    const { db, mockUpdate } = mockDb(
      guildRow({
        subStatus: "trialing",
        trialEndsAt: new Date("2026-01-01T00:00:00Z"),
        planId: "pro",
      }),
    );
    await ensureGuild(db, "g1", config, new Date("2026-02-01T00:00:00Z"));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("monthly reset clears counters but not the pack balance", async () => {
    const { db, mockSet } = mockDb(
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
