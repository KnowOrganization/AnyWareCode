import { describe, expect, it } from "vitest";
import { provenanceReceipt } from "./taskRunner.js";

describe("provenanceReceipt", () => {
  it("carries sponsor, approver, steerers, evidence, and the thread link", () => {
    const receipt = provenanceReceipt({
      initiatedBy: "discord:mo (github:MoKnowOrg)",
      planApprovedBy: "alice",
      steeredBy: ["bob", "carol"],
      testResults: [{ passed: true, summary: "12/12 passed" }],
      diffFiles: [
        { path: "a.ts", additions: 10, deletions: 2 },
        { path: "b.ts", additions: 5, deletions: 1 },
      ],
      threadUrl: "https://discord.com/channels/g/t",
    });
    expect(receipt).toContain("🧾 Provenance");
    expect(receipt).toContain("discord:mo (github:MoKnowOrg)");
    expect(receipt).toContain("Plan approved by:** discord:alice");
    expect(receipt).toContain("discord:bob, discord:carol");
    expect(receipt).toContain("✅ 12/12 passed");
    expect(receipt).toContain("2 file(s), +15 −3");
    expect(receipt).toContain("https://discord.com/channels/g/t");
    expect(receipt).toContain("humans remain the merge gate");
  });

  it("omits empty sections and admits missing evidence", () => {
    const receipt = provenanceReceipt({
      initiatedBy: "discord:mo",
      planApprovedBy: null,
      steeredBy: [],
      testResults: [],
      diffFiles: [],
      threadUrl: "https://discord.com/channels/g/t",
    });
    expect(receipt).not.toContain("Plan approved by");
    expect(receipt).not.toContain("Steered by");
    expect(receipt).toContain("no test evidence recorded");
  });
});
