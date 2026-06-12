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
    Array<{ resolve: () => void; limit: number }>
  >();

  /** Resolves when a slot is free. Returns true if the task had to queue. */
  async acquire(guildId: string, limit = 1): Promise<{ queued: boolean }> {
    const max = Math.max(1, limit);
    const current = this.running.get(guildId) ?? 0;
    if (current < max) {
      this.running.set(guildId, current + 1);
      return { queued: false };
    }
    await new Promise<void>((resolve) => {
      const queue = this.waiting.get(guildId) ?? [];
      queue.push({ resolve, limit: max });
      this.waiting.set(guildId, queue);
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
