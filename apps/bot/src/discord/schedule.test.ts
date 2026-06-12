import { describe, expect, it } from "vitest";
import { computeNextRun } from "./schedule.js";

describe("computeNextRun", () => {
  // 2026-06-12 is a Friday (UTC day 5).
  const friday10 = new Date("2026-06-12T10:00:00Z");

  it("daily: today at the hour when it's still ahead", () => {
    expect(computeNextRun("daily", 18, null, friday10).toISOString()).toBe(
      "2026-06-12T18:00:00.000Z",
    );
  });

  it("daily: tomorrow when the hour already passed (or is exactly now)", () => {
    expect(computeNextRun("daily", 9, null, friday10).toISOString()).toBe(
      "2026-06-13T09:00:00.000Z",
    );
    expect(computeNextRun("daily", 10, null, friday10).toISOString()).toBe(
      "2026-06-13T10:00:00.000Z",
    );
  });

  it("weekly: next occurrence of the target weekday", () => {
    // Monday = 1 → next Monday.
    expect(computeNextRun("weekly", 9, 1, friday10).toISOString()).toBe(
      "2026-06-15T09:00:00.000Z",
    );
    // Friday at a later hour → today.
    expect(computeNextRun("weekly", 18, 5, friday10).toISOString()).toBe(
      "2026-06-12T18:00:00.000Z",
    );
    // Friday at a passed hour → next Friday.
    expect(computeNextRun("weekly", 9, 5, friday10).toISOString()).toBe(
      "2026-06-19T09:00:00.000Z",
    );
  });

  it("downtime: next run computed from now, not the missed slot", () => {
    // A daily 09:00 schedule that was due during a 3-day outage fires once,
    // then lands on the next 09:00 after recovery.
    const recovered = new Date("2026-06-15T14:00:00Z");
    expect(computeNextRun("daily", 9, null, recovered).toISOString()).toBe(
      "2026-06-16T09:00:00.000Z",
    );
  });
});
