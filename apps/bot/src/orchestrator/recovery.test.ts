import { describe, expect, it, vi } from "vitest";
import { recoverStaleTasks } from "./recovery.js";

describe("recoverStaleTasks", () => {
  it("marks stale tasks failed, refunds usage, and notifies each thread", async () => {
    const stale = [
      { id: "t1", guildId: "g1", mode: "code" as const, threadId: "th1", status: "running", fundedBy: "plan" as const, charged: true },
      { id: "t2", guildId: "g1", mode: "ask" as const, threadId: "th2", status: "queued", fundedBy: "plan" as const, charged: true },
    ];

    // Minimal drizzle-shaped mock: update().set().where().returning()
    const mockReturning = vi.fn().mockResolvedValue(stale);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));

    const db = {
      update: mockUpdate,
    } as unknown as Parameters<typeof recoverStaleTasks>[0];

    const notify = vi.fn().mockResolvedValue(undefined);
    await recoverStaleTasks(db, notify);

    // 1 update marks the batch failed; refundUsage issues 1 update per charged task.
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "failed" }),
    );
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("th1", expect.stringContaining("rerun"));
    expect(notify).toHaveBeenCalledWith("th2", expect.stringContaining("rerun"));
  });

  it("does NOT refund plan-mode (uncharged) tasks but still notifies", async () => {
    const stale = [
      { id: "p1", guildId: "g1", mode: "code" as const, threadId: "th1", status: "running", fundedBy: "plan" as const, charged: false },
    ];
    const mockReturning = vi.fn().mockResolvedValue(stale);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));
    const db = { update: mockUpdate } as unknown as Parameters<
      typeof recoverStaleTasks
    >[0];

    const notify = vi.fn().mockResolvedValue(undefined);
    await recoverStaleTasks(db, notify);

    // Only the batch "failed" update — no refund update for the uncharged task.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("th1", expect.stringContaining("rerun"));
  });

  it("does nothing when there are no stale tasks", async () => {
    const mockReturning = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));

    const db = {
      update: mockUpdate,
    } as unknown as Parameters<typeof recoverStaleTasks>[0];

    const notify = vi.fn();
    await recoverStaleTasks(db, notify);
    expect(notify).not.toHaveBeenCalled();
  });
});
