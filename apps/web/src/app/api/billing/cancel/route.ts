import { NextResponse } from "next/server";
import { getGuild } from "@anywarecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userManagesGuild } from "@/lib/guilds";
import { getRazorpay, razorpayConfigured } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * Razorpay has no hosted billing portal, so cancellation is server-side. The
 * actual billing state flips when the resulting `subscription.cancelled`
 * webhook lands (single write path). A guild manager triggers this.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { guildId } = (await req.json()) as { guildId?: string };
  if (!guildId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await userManagesGuild(session.accessToken, guildId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
