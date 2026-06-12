import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@anywherecode/db";

export type FundedBy = "plan" | "pack";

/**
 * Consume one unit of quota. Code tasks drain the plan bucket first, then the
 * pack balance; the returned bucket is stored on the task row so a refund
 * reverses the same pool. SQL-expression increments keep concurrent tasks
 * (concurrency > 1) from losing updates.
 */
export async function bumpUsage(
  db: Db,
  guildId: string,
  mode: "code" | "ask",
): Promise<FundedBy> {
  if (mode === "ask") {
    await db
      .update(schema.guilds)
      .set({ asksUsedThisMonth: sql`${schema.guilds.asksUsedThisMonth} + 1` })
      .where(eq(schema.guilds.id, guildId));
    return "plan";
  }
  // Atomically claim a plan-bucket unit only while under cap.
  const claimed = await db
    .update(schema.guilds)
    .set({ tasksUsedThisMonth: sql`${schema.guilds.tasksUsedThisMonth} + 1` })
    .where(
      sql`${schema.guilds.id} = ${guildId} and ${schema.guilds.tasksUsedThisMonth} < ${schema.guilds.taskCap}`,
    )
    .returning({ id: schema.guilds.id });
  if (claimed.length > 0) return "plan";
  await db
    .update(schema.guilds)
    .set({
      packTasksRemaining: sql`greatest(${schema.guilds.packTasksRemaining} - 1, 0)`,
    })
    .where(eq(schema.guilds.id, guildId));
  return "pack";
}

/** Reverse a consumed unit in the bucket it came from. */
export async function refundUsage(
  db: Db,
  guildId: string,
  mode: "code" | "ask",
  fundedBy: FundedBy = "plan",
): Promise<void> {
  if (mode === "ask") {
    await db
      .update(schema.guilds)
      .set({
        asksUsedThisMonth: sql`greatest(${schema.guilds.asksUsedThisMonth} - 1, 0)`,
      })
      .where(eq(schema.guilds.id, guildId));
    return;
  }
  if (fundedBy === "pack") {
    await db
      .update(schema.guilds)
      .set({
        packTasksRemaining: sql`${schema.guilds.packTasksRemaining} + 1`,
      })
      .where(eq(schema.guilds.id, guildId));
    return;
  }
  await db
    .update(schema.guilds)
    .set({
      tasksUsedThisMonth: sql`greatest(${schema.guilds.tasksUsedThisMonth} - 1, 0)`,
    })
    .where(eq(schema.guilds.id, guildId));
}
