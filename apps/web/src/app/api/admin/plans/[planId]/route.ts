import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlan, updatePlan, writeAudit } from "@anywherecode/db";
import { db } from "@/lib/db";
import { withAdmin } from "@/lib/adminRoute";

export const runtime = "nodejs";

const Body = z
  .object({
    planId: z.string(),
    name: z.string().min(1).optional(),
    taskCap: z.number().int().min(0).optional(),
    concurrency: z.number().int().min(1).optional(),
    features: z.array(z.string()).optional(),
    razorpayPlanIdInr: z.string().nullable().optional(),
    razorpayPlanIdUsd: z.string().nullable().optional(),
  })
  .strict();

/** Edit a tier/plan row. NOTE: existing guilds keep their mirrored taskCap
 * until their next subscription event or an admin "Set tier" — surfaced as a
 * warning in the response. */
export const PUT = withAdmin(Body, async ({ body, actorId }) => {
  const { planId, ...patch } = body;
  const before = await getPlan(db, planId);
  if (!before) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  const after = await updatePlan(db, planId, patch);
  await writeAudit(db, {
    actorDiscordId: actorId,
    action: "plan.update",
    targetType: "plan",
    targetId: planId,
    before,
    after,
  });
  return NextResponse.json({
    ok: true,
    plan: after,
    warning:
      "Existing guilds keep their current cap until their next subscription event or an admin Set-tier action.",
  });
});
