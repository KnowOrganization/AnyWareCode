import { eq } from "drizzle-orm";
import { schema, type Db } from "@anywherecode/db";

export async function bumpUsage(
  db: Db,
  guildId: string,
  mode: "code" | "ask",
): Promise<void> {
  const guild = await db.query.guilds.findFirst({
    where: eq(schema.guilds.id, guildId),
  });
  if (!guild) return;
  await db
    .update(schema.guilds)
    .set(
      mode === "code"
        ? { tasksUsedThisMonth: guild.tasksUsedThisMonth + 1 }
        : { asksUsedThisMonth: guild.asksUsedThisMonth + 1 },
    )
    .where(eq(schema.guilds.id, guildId));
}

export async function refundUsage(
  db: Db,
  guildId: string,
  mode: "code" | "ask",
): Promise<void> {
  const guild = await db.query.guilds.findFirst({
    where: eq(schema.guilds.id, guildId),
  });
  if (!guild) return;
  await db
    .update(schema.guilds)
    .set(
      mode === "code"
        ? { tasksUsedThisMonth: Math.max(0, guild.tasksUsedThisMonth - 1) }
        : { asksUsedThisMonth: Math.max(0, guild.asksUsedThisMonth - 1) },
    )
    .where(eq(schema.guilds.id, guildId));
}
