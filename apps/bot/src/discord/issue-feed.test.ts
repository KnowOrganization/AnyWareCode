import { describe, expect, it } from "vitest";
import {
  issuePassesFilters,
  issuePrompt,
  nextDailyCount,
  type IssueInfo,
} from "./issue-feed.js";

function issue(overrides: Partial<IssueInfo> = {}): IssueInfo {
  return {
    number: 7,
    title: "Crash on respawn",
    body: "Player crashes when respawning",
    labels: ["bug"],
    authorAssociation: "NONE",
    authorIsBot: false,
    isPullRequest: false,
    ...overrides,
  };
}

describe("issuePassesFilters", () => {
  it("skips bots and PR-shaped issues", () => {
    const settings = { issueLabels: [], issueMinAssoc: "any" as const };
    expect(issuePassesFilters(settings, issue({ authorIsBot: true }))).toBe(false);
    expect(issuePassesFilters(settings, issue({ isPullRequest: true }))).toBe(false);
    expect(issuePassesFilters(settings, issue())).toBe(true);
  });

  it("requires a label intersection when an allowlist is set", () => {
    const settings = { issueLabels: ["good-first-issue"], issueMinAssoc: "any" as const };
    expect(issuePassesFilters(settings, issue({ labels: ["bug"] }))).toBe(false);
    expect(
      issuePassesFilters(settings, issue({ labels: ["bug", "good-first-issue"] })),
    ).toBe(true);
  });

  it("enforces the author-trust ladder", () => {
    const settings = { issueLabels: [], issueMinAssoc: "member" as const };
    expect(issuePassesFilters(settings, issue({ authorAssociation: "CONTRIBUTOR" }))).toBe(false);
    expect(issuePassesFilters(settings, issue({ authorAssociation: "MEMBER" }))).toBe(true);
    expect(issuePassesFilters(settings, issue({ authorAssociation: "OWNER" }))).toBe(true);
  });
});

describe("nextDailyCount", () => {
  const now = new Date("2026-06-12T10:00:00Z");

  it("starts a fresh UTC day at 1", () => {
    expect(
      nextDailyCount(
        { issueDailyCap: 10, issueCountToday: 9, issueCountDate: new Date("2026-06-11T23:00:00Z") },
        now,
      ),
    ).toBe(1);
  });

  it("increments within the same day and stops at the cap", () => {
    const sameDay = new Date("2026-06-12T01:00:00Z");
    expect(
      nextDailyCount({ issueDailyCap: 10, issueCountToday: 4, issueCountDate: sameDay }, now),
    ).toBe(5);
    expect(
      nextDailyCount({ issueDailyCap: 10, issueCountToday: 10, issueCountDate: sameDay }, now),
    ).toBeNull();
  });
});

describe("issuePrompt", () => {
  it("frames the issue body as untrusted", () => {
    const prompt = issuePrompt("o/r", issue());
    expect(prompt).toContain("<issue_content>");
    expect(prompt).toContain("untrusted");
    expect(prompt.indexOf("untrusted")).toBeLessThan(prompt.indexOf("Crash on respawn"));
  });
});
