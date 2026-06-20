/**
 * In-process per-guild concurrency limiter (v1 stand-in for a real queue).
 * The limit comes from the guild's plan and is passed per acquire; waiters
 * capture the limit they saw at enqueue time, so a mid-flight downgrade
 * applies to new acquires while running tasks finish unharmed.
 */
export class GuildTaskLimiter {
  private running = new Map<string, number>();
  private waiting = new Map<
    string,
    Array<{ resolve: () => void; reject: (err: unknown) => void; limit: number }>
  >();

  /**
   * Resolves when a slot is free. Returns true if the task had to queue.
   * Pass an AbortSignal to unblock early on cancel — the returned Promise
   * rejects with an Error so the caller can distinguish abort from a crash.
   */
  async acquire(
    guildId: string,
    limit = 1,
    signal?: AbortSignal,
  ): Promise<{ queued: boolean }> {
    const max = Math.max(1, limit);
    const current = this.running.get(guildId) ?? 0;
    if (current < max) {
      this.running.set(guildId, current + 1);
      return { queued: false };
    }
    await new Promise<void>((resolve, reject) => {
      // Already aborted before we even queued.
      if (signal?.aborted) {
        reject(new Error("Task cancelled while queued."));
        return;
      }
      const queue = this.waiting.get(guildId) ?? [];
      const entry = { resolve, reject, limit: max };
      queue.push(entry);
      this.waiting.set(guildId, queue);
      signal?.addEventListener(
        "abort",
        () => {
          const q = this.waiting.get(guildId);
          const i = q?.indexOf(entry) ?? -1;
          if (i >= 0) q!.splice(i, 1);
          reject(new Error("Task cancelled while queued."));
        },
        { once: true },
      );
    });
    this.running.set(guildId, (this.running.get(guildId) ?? 0) + 1);
    return { queued: true };
  }

  release(guildId: string): void {
    const current = this.running.get(guildId) ?? 0;
    const next = Math.max(0, current - 1);
    this.running.set(guildId, next);
    // FIFO: wake the head only when its captured limit has room.
    const queue = this.waiting.get(guildId);
    const head = queue?.[0];
    if (head && next < head.limit) {
      queue?.shift();
      head.resolve();
    }
  }

  runningCount(guildId: string): number {
    return this.running.get(guildId) ?? 0;
  }
}
