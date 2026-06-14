import { NextResponse } from "next/server";
import { getGuild } from "@anywherecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userInGuild } from "@/lib/guilds";
import { packPurchasable } from "@/lib/plan";
import {
  APP_URL,
  PACK_AMOUNTS,
  currencyFor,
  getRazorpay,
  resolveCurrency,
} from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * Task-pack checkout — community-funded compute. Any *member* of the guild may
 * buy (membership check, not MANAGE_GUILD). One-time Razorpay Payment Link; the
 * pack belongs to the server, not the buyer.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken || !session.discordId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { guildId, currency } = (await req.json()) as {
    guildId?: string;
    currency?: string;
  };
  if (!guildId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await userInGuild(session.accessToken, guildId))) {
    return NextResponse.json(
      { error: "Not a member of that server" },
      { status: 403 },
    );
  }
  const guild = await getGuild(db, guildId);
  if (!guild) {
    return NextResponse.json({ error: "Bot not installed" }, { status: 404 });
  }
  if (!packPurchasable(guild)) {
    return NextResponse.json(
      { error: "Task packs need an active plan (OSS, Pro, or Studio) first" },
      { status: 409 },
    );
  }

  const cur = resolveCurrency(currency, currencyFor(req));
  // The razorpay SDK's create types are over-constrained; pass a loose body.
  const createLink = getRazorpay().paymentLink.create as unknown as (
    body: Record<string, unknown>,
  ) => Promise<{ short_url?: string }>;
  const link = await createLink({
    amount: PACK_AMOUNTS[cur],
    currency: cur,
    accept_partial: false,
    notes: {
      kind: "task_pack",
      guildId,
      purchasedBy: session.discordId,
      purchaserName: session.user?.name ?? "a member",
    },
    callback_url: `${APP_URL}/packs/${guildId}?powered=1`,
    callback_method: "get",
  });

  if (!link.short_url) {
    return NextResponse.json(
      { error: "Could not start checkout" },
      { status: 502 },
    );
  }
  return NextResponse.json({ url: link.short_url });
}
