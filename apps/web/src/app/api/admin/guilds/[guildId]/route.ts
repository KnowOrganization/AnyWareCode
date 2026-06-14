import { NextResponse } from "next/server";
import { z } from "zod";
import {
  adjustPackTasks,
  adminSetGuildBilling,
  getGuild,
  setGuildSuspended,
  writeAudit,
} from "@anywarecode/db";
import { db } from "@/lib/db";
import { withAdmin } from "@/lib/adminRoute";
import { guildAuditView } from "@/lib/adminViews";

export const runtime = "nodejs";

const Body = z
  .object({
    guildId: z.string(),
    subStatus: z
      .enum(["active", "past_due", "canceled", "free"])
      .optional(),
    currentPeriodEnd: z.string().datetime().nullable().optional(),
    /** Add (positive) or remove (negative) pack tasks. */
    packsDelta: z.number().int().optional(),
    resetUsage: z.boolean().optional(),
    suspended: z.boolean().optional(),
    /** Required true for the destructive ops (suspend, reset, big revoke). */
    confirm: z.boolean().optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .strict();

/** One audited write covering status / period / packs / usage / suspend.
 * Destructive ops require `confirm:true`. */
export const PATCH = withAdmin(Body, async ({ body, actorId }) => {
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

  const destructive =
    body.suspended === true || body.resetUsage === true ||
    (body.packsDelta ?? 0) < 0;
  if (destructive && body.confirm !== true) {
    return NextResponse.json(
      { error: "This action needs confirm:true" },
      { status: 400 },
    );
  }

  // Billing fields (status/period/usage) go through the choke point.
  const billing: Parameters<typeof adminSetGuildBilling>[2] = {};
  if (body.subStatus !== undefined) billing.subStatus = body.subStatus;
  if (body.currentPeriodEnd !== undefined)
    billing.currentPeriodEnd = body.currentPeriodEnd
      ? new Date(body.currentPeriodEnd)
      : null;
  if (body.resetUsage) billing.resetUsage = true;
  if (Object.keys(billing).length > 0) {
    await adminSetGuildBilling(db, body.guildId, billing);
  }
  if (body.suspended !== undefined) {
    await setGuildSuspended(db, body.guildId, body.suspended);
  }
  if (body.packsDelta !== undefined && body.packsDelta !== 0) {
    await adjustPackTasks(db, body.guildId, body.packsDelta);
  }

  const after = await getGuild(db, body.guildId);
  await writeAudit(db, {
    actorDiscordId: actorId,
    action: "guild.update",
    targetType: "guild",
    targetId: body.guildId,
    before: guildAuditView(before),
    after: guildAuditView(after),
  });
  return NextResponse.json({ ok: true, guild: guildAuditView(after) });
});
