import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@anywherecode/db";

export type FundedBy = "plan" | "pack";

/**
 * Atomically claim `n` code-task units: plan bucket first, pack remainder.
 * All-or-nothing — a shortfall claims nothing and returns null (no partial
 * spend, no free units when both buckets are dry). The guild row is locked
 * for the duration, so concurrent claims (squads, parallel tasks) serialize.
 * The returned list maps 1:1 onto attempts so each refund hits its bucket.
 */
export async function claimUnits(
  db: Db,
  guildId: string,
  n: number,
): Promise<FundedBy[] | null> {
  if (n <= 0) return [];
  return db.transaction(async (tx) => {
    const [guild] = await tx
      .select({
        taskCap: schema.guilds.taskCap,
        tasksUsedThisMonth: schema.guilds.tasksUsedThisMonth,
        packTasksRemaining: schema.guilds.packTasksRemaining,
      })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .for("update");
    if (!guild) return null;
    const fromPlan = Math.min(
      n,
      Math.max(0, guild.taskCap - guild.tasksUsedThisMonth),
    );
    const fromPack = n - fromPlan;
    if (fromPack > guild.packTasksRemaining) return null;
    await tx
      .update(schema.guilds)
      .set({
        tasksUsedThisMonth: guild.tasksUsedThisMonth + fromPlan,
        packTasksRemaining: guild.packTasksRemaining - fromPack,
      })
      .where(eq(schema.guilds.id, guildId));
    return [
      ...Array<FundedBy>(fromPlan).fill("plan"),
      ...Array<FundedBy>(fromPack).fill("pack"),
    ];
  });
}

/**
 * Consume one unit of quota. Code tasks drain the plan bucket first, then the
 * pack balance; the returned bucket is stored on the task row so a refund
 * reverses the same pool.
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
  const claimed = await claimUnits(db, guildId, 1);
  if (claimed?.[0]) return claimed[0];
  // Race: the cap check passed at precondition time but both buckets drained
  // before this claim. The launch is already committed, so charge the plan
  // bucket (refundable overage) rather than minting a free pack unit.
  await db
    .update(schema.guilds)
    .set({ tasksUsedThisMonth: sql`${schema.guilds.tasksUsedThisMonth} + 1` })
    .where(eq(schema.guilds.id, guildId));
  return "plan";
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
