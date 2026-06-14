import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adminSetGuildBilling,
  getGuild,
  getPlan,
  writeAudit,
} from "@anywarecode/db";
import { db } from "@/lib/db";
import { withAdmin } from "@/lib/adminRoute";
import { guildAuditView } from "@/lib/adminViews";

export const runtime = "nodejs";

const Body = z
  .object({
    guildId: z.string(),
    planId: z.string().nullable(),
    expectedUpdatedAt: z.string().optional(),
  })
  .strict();

/** Set a guild's tier (planId). Forces subSource="admin" + mirrors the plan's
 * taskCap/concurrency onto the guild so the bot's hot path sees the new cap. */
export const POST = withAdmin(Body, async ({ body, actorId }) => {
  const before = await getGuild(db, body.guildId);
  if (!before) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
  }
  if (
    body.expectedUpdatedAt &&
    before.updatedAt.toISOString() !== body.expectedUpdatedAt
  ) {
    return NextResponse.json(
      { error: "Guild changed since you loaded it — refresh." },
      { status: 409 },
    );
  }
  if (body.planId === null) {
    await adminSetGuildBilling(db, body.guildId, {
      planId: null,
      subStatus: "free",
      taskCap: 0,
      concurrency: 1,
    });
  } else {
    const plan = await getPlan(db, body.planId);
    if (!plan) {
      return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    }
    await adminSetGuildBilling(db, body.guildId, {
      planId: plan.id,
      subStatus: "active",
      taskCap: plan.taskCap,
      concurrency: plan.concurrency,
    });
  }
  const after = await getGuild(db, body.guildId);
  await writeAudit(db, {
    actorDiscordId: actorId,
    action: "guild.setTier",
    targetType: "guild",
    targetId: body.guildId,
    before: guildAuditView(before),
    after: guildAuditView(after),
  });
  return NextResponse.json({ ok: true, guild: guildAuditView(after) });
});
