import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applyOssDecision,
  getPlan,
  listGuildInstallations,
  listPendingOssApplications,
  writeAudit,
} from "@anywarecode/db";
import { AdminForbidden, requireAdmin } from "@/lib/admin";
import { withAdmin } from "@/lib/adminRoute";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Operator review queue for OSS Community tier applications. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    const status = err instanceof AdminForbidden ? 403 : 500;
    return NextResponse.json({ error: "Forbidden" }, { status });
  }
  const pending = await listPendingOssApplications(db);
  return NextResponse.json({
    pending: await Promise.all(
      pending.map(async (g) => ({
        guildId: g.id,
        githubAccounts: (await listGuildInstallations(db, g.id)).map(
          (i) => i.accountLogin,
        ),
        appliedAt: g.ossAppliedAt,
      })),
    ),
  });
}

const Body = z
  .object({ guildId: z.string(), approve: z.boolean() })
  .strict();

export const POST = withAdmin(Body, async ({ body, actorId }) => {
  const ossPlan = await getPlan(db, "oss");
  if (!ossPlan) {
    return NextResponse.json(
      { error: "oss plan row missing — run the db seed" },
      { status: 500 },
    );
  }
  await applyOssDecision(db, body.guildId, body.approve, ossPlan);
  await writeAudit(db, {
    actorDiscordId: actorId,
    action: "oss.decide",
    targetType: "guild",
    targetId: body.guildId,
    after: { approve: body.approve },
  });
  return NextResponse.json({ ok: true, guildId: body.guildId, approve: body.approve });
});
