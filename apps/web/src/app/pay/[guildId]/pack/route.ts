import { NextResponse } from "next/server";
import { getGuild } from "@anywarecode/db";
import { db } from "@/lib/db";
import {
  createPackUrl,
  currencyFor,
  resolveCurrency,
  verifyPackToken,
} from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * No-login Job Pack redirect. The bot builds a signed `?t=` token carrying the
 * buyer's Discord identity (for the public thank-you credit); without a valid
 * token the pack is still purchasable but unattributed. Currency geo-detected.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  const guild = await getGuild(db, guildId);
  if (!guild) {
    return NextResponse.json({ error: "Bot not installed" }, { status: 404 });
  }
  // Attribution is best-effort: only trust a signed token that matches this guild.
  const token = new URL(req.url).searchParams.get("t");
  const claim = token ? verifyPackToken(token) : null;
  const buyer =
    claim && claim.g === guildId
      ? { buyerId: claim.u, buyerName: claim.n }
      : {};
  try {
    const url = await createPackUrl({
      guildId,
      currency: resolveCurrency(null, currencyFor(req)),
      ...buyer,
    });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 502 },
    );
  }
}
