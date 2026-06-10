/**
 * In-process per-guild concurrency limiter (v1 stand-in for a real queue).
 * One running task per guild; later /code invocations wait FIFO.
 */
export class GuildTaskLimiter {
  private running = new Map<string, number>();
  private waiting = new Map<string, Array<() => void>>();

  constructor(private maxPerGuild = 1) {}

  /** Resolves when a slot is free. Returns true if the task had to queue. */
  async acquire(guildId: string): Promise<{ queued: boolean }> {
    const current = this.running.get(guildId) ?? 0;
    if (current < this.maxPerGuild) {
      this.running.set(guildId, current + 1);
      return { queued: false };
    }
    await new Promise<void>((resolve) => {
      const queue = this.waiting.get(guildId) ?? [];
      queue.push(resolve);
      this.waiting.set(guildId, queue);
    });
    this.running.set(guildId, (this.running.get(guildId) ?? 0) + 1);
    return { queued: true };
  }

  release(guildId: string): void {
    const current = this.running.get(guildId) ?? 0;
    this.running.set(guildId, Math.max(0, current - 1));
    const next = this.waiting.get(guildId)?.shift();
    next?.();
  }

  runningCount(guildId: string): number {
    return this.running.get(guildId) ?? 0;
  }
}
