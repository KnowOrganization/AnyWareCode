import { NextResponse } from "next/server";
import { getGuild } from "@anywarecode/db";
import { db } from "@/lib/db";
import {
  createSubscriptionUrl,
  currencyFor,
  resolveCurrency,
} from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * No-login subscription redirect. The bot links here from `/billing` (it has
 * already gated on ManageGuild); paying for a server is harmless even if the
 * link is shared. Currency is geo-detected from the request. Creates the
 * Razorpay subscription and 302s to its hosted checkout.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const plan = new URL(req.url).searchParams.get("plan");
  if (plan !== "pro" && plan !== "studio") {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  const guild = await getGuild(db, guildId);
  if (!guild) {
    return NextResponse.json({ error: "Bot not installed" }, { status: 404 });
  }
  try {
    const url = await createSubscriptionUrl(
      guildId,
      plan,
      resolveCurrency(null, currencyFor(req)),
    );
    return NextResponse.redirect(url, 303);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 502 },
    );
  }
}
