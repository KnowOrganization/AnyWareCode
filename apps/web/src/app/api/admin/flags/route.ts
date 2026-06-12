import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@anywherecode/db";
import { isAdminRequest } from "@/lib/admin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** Operator kill switches. The bot reads these with a 60s cache — flipping a
 * flag here takes effect within a minute, no redeploy. */
const ALLOWED_FLAGS = ["claude_oauth_enabled"] as const;

export async function GET(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const flags: Record<string, unknown> = {};
  for (const key of ALLOWED_FLAGS) flags[key] = await getSetting(db, key);
  return NextResponse.json({ flags });
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { key, value } = (await req.json()) as { key?: string; value?: unknown };
  if (
    !key ||
    !(ALLOWED_FLAGS as readonly string[]).includes(key) ||
    typeof value !== "boolean"
  ) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  await setSetting(db, key, value);
  return NextResponse.json({ ok: true, key, value });
}
