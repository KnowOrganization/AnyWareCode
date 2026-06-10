import { describe, expect, it } from "vitest";
import type { Guild } from "../db/schema.js";
import { capState, nextMonthStart } from "./gates.js";

function guildRow(overrides: Partial<Guild> = {}): Guild {
  return {
    id: "g1",
    githubInstallationId: 1,
    allowedRoleId: null,
    taskCap: 10,
    tasksUsedThisMonth: 0,
    asksUsedThisMonth: 0,
    capResetAt: new Date("2099-01-01T00:00:00Z"),
    createdAt: new Date(),
    llmProviderType: null,
    llmCredentialEnc: null,
    llmBaseUrl: null,
    llmModel: null,
    llmCredentialSetAt: null,
    ...overrides,
  };
}

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
