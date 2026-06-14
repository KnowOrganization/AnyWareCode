import { NextResponse } from "next/server";
import { z } from "zod";
import { getSetting, setSetting, writeAudit } from "@anywarecode/db";
import { AdminForbidden, requireAdmin } from "@/lib/admin";
import { withAdmin } from "@/lib/adminRoute";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Operator kill switches. The bot reads these with a 60s cache — flipping a
 * flag here takes effect within a minute, no redeploy. */
const ALLOWED_FLAGS = ["claude_oauth_enabled"] as const;

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    const status = err instanceof AdminForbidden ? 403 : 500;
    return NextResponse.json({ error: "Forbidden" }, { status });
  }
  const flags: Record<string, unknown> = {};
  for (const key of ALLOWED_FLAGS) flags[key] = await getSetting(db, key);
  return NextResponse.json({ flags });
}

const Body = z
  .object({ key: z.enum(ALLOWED_FLAGS), value: z.boolean() })
  .strict();

export const POST = withAdmin(Body, async ({ body, actorId }) => {
  await setSetting(db, body.key, body.value);
  await writeAudit(db, {
    actorDiscordId: actorId,
    action: "flag.set",
    targetType: "flag",
    targetId: body.key,
    after: { value: body.value },
  });
  return NextResponse.json({ ok: true, key: body.key, value: body.value });
});
