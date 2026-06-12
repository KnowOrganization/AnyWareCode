import { describe, expect, it } from "vitest";
import { GuildTaskLimiter } from "./limiter.js";

async function settled<T>(p: Promise<T>): Promise<boolean> {
  const marker = Symbol();
  const r = await Promise.race([p, Promise.resolve(marker)]);
  return r !== marker;
}

describe("GuildTaskLimiter", () => {
  it("runs up to the per-call limit concurrently", async () => {
    const limiter = new GuildTaskLimiter();
    expect((await limiter.acquire("g", 2)).queued).toBe(false);
    expect((await limiter.acquire("g", 2)).queued).toBe(false);
    expect(limiter.runningCount("g")).toBe(2);
  });

  it("queues past the limit and frees on release", async () => {
    const limiter = new GuildTaskLimiter();
    await limiter.acquire("g", 1);
    const second = limiter.acquire("g", 1);
    expect(await settled(second)).toBe(false);
    limiter.release("g");
    expect((await second).queued).toBe(true);
    expect(limiter.runningCount("g")).toBe(1);
  });

  it("wakes queued waiters in FIFO order", async () => {
    const limiter = new GuildTaskLimiter();
    await limiter.acquire("g", 1);
    const order: string[] = [];
    const a = limiter.acquire("g", 1).then(() => order.push("a"));
    const b = limiter.acquire("g", 1).then(() => order.push("b"));
    limiter.release("g");
    await a;
    expect(order).toEqual(["a"]);
    limiter.release("g");
    await b;
    expect(order).toEqual(["a", "b"]);
  });

  it("lets an upgraded limit start immediately even with older waiters", async () => {
    // Mixed limits only exist transiently around a plan change; an acquire
    // checks its own limit against running count, not the waiting queue.
    const limiter = new GuildTaskLimiter();
    await limiter.acquire("g", 1);
    const waiting = limiter.acquire("g", 1);
    expect((await limiter.acquire("g", 3)).queued).toBe(false);
    expect(await settled(waiting)).toBe(false);
    expect(limiter.runningCount("g")).toBe(2);
  });

  it("applies a mid-flight downgrade to new acquires while running tasks finish", async () => {
    const limiter = new GuildTaskLimiter();
    await limiter.acquire("g", 2);
    await limiter.acquire("g", 2);
    // Plan downgraded: next acquire sees limit 1.
    const queued = limiter.acquire("g", 1);
    expect(await settled(queued)).toBe(false);
    limiter.release("g");
    // One task still running — the limit-1 waiter must keep waiting.
    expect(await settled(queued)).toBe(false);
    limiter.release("g");
    await queued;
    expect(limiter.runningCount("g")).toBe(1);
  });

  it("isolates guilds from each other", async () => {
    const limiter = new GuildTaskLimiter();
    await limiter.acquire("g1", 1);
    expect((await limiter.acquire("g2", 1)).queued).toBe(false);
  });
});
