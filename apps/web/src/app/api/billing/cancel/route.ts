import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getGuild } from "@anywarecode/db";
import { db } from "@/lib/db";
import { getRazorpay, razorpayConfigured } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * Cancellation is bot-driven: the Discord `/billing` Cancel button (gated on
 * ManageGuild) calls this with a shared-secret bearer. There is no user web
 * surface. The actual billing state flips when the `subscription.cancelled`
 * webhook lands (single write path).
 */
function bearerOk(req: Request): boolean {
  const secret = process.env.BILLING_BRIDGE_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!bearerOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { guildId } = (await req.json().catch(() => ({}))) as {
    guildId?: string;
  };
  if (!guildId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!razorpayConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured" },
      { status: 501 },
    );
  }
  const guild = await getGuild(db, guildId);
  if (!guild?.razorpaySubscriptionId) {
    return NextResponse.json(
      { error: "No active subscription to cancel" },
      { status: 400 },
    );
  }
  // cancel_at_cycle_end keeps access until the paid period ends.
  await getRazorpay().subscriptions.cancel(guild.razorpaySubscriptionId, true);
  return NextResponse.json({ cancelled: true });
}
