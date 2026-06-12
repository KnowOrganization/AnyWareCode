import { describe, expect, it } from "vitest";
import { PermissionFlagsBits, type APIInteractionGuildMember } from "discord.js";
import type { Guild } from "@anywherecode/db";
import { canApprovePlan } from "./plan-votes.js";

function member(roles: string[], permissions = "0"): APIInteractionGuildMember {
  return { roles, permissions } as unknown as APIInteractionGuildMember;
}

function guild(overrides: Partial<Guild>): Guild {
  return {
    allowedRoleId: null,
    planVoteMode: "one_approval",
    planVoteRoleId: null,
    ...overrides,
  } as Guild;
}

describe("canApprovePlan", () => {
  const admin = member([], PermissionFlagsBits.ManageGuild.toString());

  it("one_approval: anyone who may invoke — requester included", () => {
    const g = guild({ planVoteMode: "one_approval", allowedRoleId: "dev" });
    expect(canApprovePlan(g, member(["dev"]))).toBe(true);
    expect(canApprovePlan(g, member(["other"]))).toBe(false);
    expect(canApprovePlan(g, admin)).toBe(true);
  });

  it("role_gated: the approver role or ManageGuild only", () => {
    const g = guild({
      planVoteMode: "role_gated",
      planVoteRoleId: "leads",
      allowedRoleId: "dev",
    });
    expect(canApprovePlan(g, member(["leads"]))).toBe(true);
    // canInvoke isn't enough under role_gated.
    expect(canApprovePlan(g, member(["dev"]))).toBe(false);
    expect(canApprovePlan(g, admin)).toBe(true);
  });

  it("role_gated without a role falls back to admins", () => {
    const g = guild({ planVoteMode: "role_gated", planVoteRoleId: null });
    expect(canApprovePlan(g, member(["anything"]))).toBe(false);
    expect(canApprovePlan(g, admin)).toBe(true);
  });
});
