import { NextResponse } from "next/server";
import {
  applyOssDecision,
  getPlan,
  listPendingOssApplications,
} from "@anywherecode/db";
import { isAdminRequest } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Operator review queue for OSS Community tier applications. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const pending = await listPendingOssApplications(db);
  return NextResponse.json({
    pending: pending.map((g) => ({
      guildId: g.id,
      githubAccountLogin: g.githubAccountLogin,
      appliedAt: g.ossAppliedAt,
    })),
  });
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { guildId, approve } = (await req.json()) as {
    guildId?: string;
    approve?: boolean;
  };
  if (!guildId || typeof approve !== "boolean") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const ossPlan = await getPlan(db, "oss");
  if (!ossPlan) {
    return NextResponse.json(
      { error: "oss plan row missing — run the db seed" },
      { status: 500 },
    );
  }
  await applyOssDecision(db, guildId, approve, ossPlan);
  return NextResponse.json({ ok: true, guildId, approve });
}
