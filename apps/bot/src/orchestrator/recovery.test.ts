import { describe, expect, it, vi } from "vitest";
import { recoverStaleTasks } from "./recovery.js";

describe("recoverStaleTasks", () => {
  it("marks stale tasks failed, refunds usage, and notifies each thread", async () => {
    const stale = [
      { id: "t1", guildId: "g1", mode: "code" as const, threadId: "th1", status: "running" },
      { id: "t2", guildId: "g1", mode: "ask" as const, threadId: "th2", status: "queued" },
    ];

    // Minimal drizzle-shaped mock: update().set().where().returning()
    const mockReturning = vi.fn().mockResolvedValue(stale);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));

    // refundUsage calls db.query.guilds.findFirst — return null to short-circuit
    const mockFindFirst = vi.fn().mockResolvedValue(null);

    const db = {
      update: mockUpdate,
      query: { guilds: { findFirst: mockFindFirst } },
    } as unknown as Parameters<typeof recoverStaleTasks>[0];

    const notify = vi.fn().mockResolvedValue(undefined);
    await recoverStaleTasks(db, notify);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("th1", expect.stringContaining("rerun"));
    expect(notify).toHaveBeenCalledWith("th2", expect.stringContaining("rerun"));
  });

  it("does nothing when there are no stale tasks", async () => {
    const mockReturning = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));

    const db = {
      update: mockUpdate,
      query: { guilds: { findFirst: vi.fn() } },
    } as unknown as Parameters<typeof recoverStaleTasks>[0];

    const notify = vi.fn();
    await recoverStaleTasks(db, notify);
    expect(notify).not.toHaveBeenCalled();
  });
});
