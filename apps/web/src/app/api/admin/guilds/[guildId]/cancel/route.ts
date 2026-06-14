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
import { getRazorpay, razorpayConfigured } from "@/lib/razorpay";

export const runtime = "nodejs";

const Body = z
  .object({
    guildId: z.string(),
    confirm: z.literal(true),
    expectedUpdatedAt: z.string().optional(),
  })
  .strict();

/** Cancel the guild's Razorpay subscription (server-side; no portal). The
 * billing state also flips here so the panel reflects it immediately. */
export const POST = withAdmin(Body, async ({ body, actorId }) => {
  const before = await getGuild(db, body.guildId);
  if (!before) {
    return NextResponse.json({ error: "Guild not found" }, { status: 404 });
  }
  if (before.razorpaySubscriptionId && razorpayConfigured()) {
    try {
      await getRazorpay().subscriptions.cancel(
        before.razorpaySubscriptionId,
        true,
      );
    } catch {
      return NextResponse.json(
        { error: "Razorpay cancel failed" },
        { status: 502 },
      );
    }
  }
  // Drop to the Free floor (BYO-LLM), not to zero — mirrors the Razorpay + Discord
  // cancel paths so the panel/dashboard never shows a 0/0 dead state.
  const free = await getPlan(db, "free");
  await adminSetGuildBilling(db, body.guildId, {
    subStatus: "free",
    planId: "free",
    taskCap: free?.taskCap ?? 15,
    concurrency: free?.concurrency ?? 1,
    razorpaySubscriptionId: null,
  });
  const after = await getGuild(db, body.guildId);
  await writeAudit(db, {
    actorDiscordId: actorId,
    action: "guild.cancel",
    targetType: "guild",
    targetId: body.guildId,
    before: guildAuditView(before),
    after: guildAuditView(after),
  });
  return NextResponse.json({ ok: true, guild: guildAuditView(after) });
});
