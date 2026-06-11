import { describe, expect, it } from "vitest";
import { proposalMessage, proposalUsable } from "./proposals.js";

const NOW = new Date("2026-06-11T12:00:00Z");
const LATER = new Date("2026-06-11T13:00:00Z");

describe("proposalUsable", () => {
  it("accepts a pending, unexpired proposal", () => {
    expect(proposalUsable({ status: "pending", expiresAt: LATER }, NOW)).toBe(
      true,
    );
  });

  it("rejects expired proposals", () => {
    expect(proposalUsable({ status: "pending", expiresAt: NOW }, LATER)).toBe(
      false,
    );
  });

  it("rejects accepted and dismissed proposals", () => {
    expect(proposalUsable({ status: "accepted", expiresAt: LATER }, NOW)).toBe(
      false,
    );
    expect(proposalUsable({ status: "dismissed", expiresAt: LATER }, NOW)).toBe(
      false,
    );
  });
});

describe("proposalMessage", () => {
  it("builds customIds that round-trip through the aw:<action> parser under 100 chars", () => {
    const msg = proposalMessage("Fix login 500", "Fix the refresh handler", "abcd1234");
    const row = msg.components?.[0] as unknown as {
      components: { data: { custom_id: string } }[];
    };
    const ids = row.components.map((c) => c.data.custom_id);
    expect(ids).toEqual([
      "aw:proposal:run:abcd1234",
      "aw:proposal:dismiss:abcd1234",
    ]);
    for (const id of ids) {
      expect(id.length).toBeLessThan(100);
      const parts = id.split(":");
      expect(parts[0]).toBe("aw");
      expect(parts[1]).toBe("proposal");
      expect(["run", "dismiss"]).toContain(parts[2]);
      expect(parts[3]).toBe("abcd1234");
    }
  });

  it("truncates long prompts and never allows pings", () => {
    const msg = proposalMessage("s".repeat(300), "p".repeat(800), "abcd1234");
    expect(msg.content!.length).toBeLessThan(600);
    expect(msg.allowedMentions).toEqual({ parse: [] });
  });
});
