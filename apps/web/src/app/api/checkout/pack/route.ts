import { NextResponse } from "next/server";
import { getGuild } from "@anywherecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userInGuild } from "@/lib/guilds";
import { packPurchasable } from "@/lib/plan";
import { APP_URL, PACK_PRICE_ID, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Task-pack checkout — community-funded compute. Any *member* of the guild may
 * buy (membership check, not MANAGE_GUILD), one-time payment mode, and no
 * Stripe customer is attached: the pack belongs to the server, not the buyer.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken || !session.discordId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { guildId } = (await req.json()) as { guildId?: string };
  if (!guildId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await userInGuild(session.accessToken, guildId))) {
    return NextResponse.json({ error: "Not a member of that server" }, { status: 403 });
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
  if (!PACK_PRICE_ID) {
    return NextResponse.json({ error: "Packs not configured" }, { status: 500 });
  }

  const checkout = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: PACK_PRICE_ID, quantity: 1 }],
    metadata: {
      kind: "task_pack",
      guildId,
      purchasedBy: session.discordId,
      purchaserName: session.user?.name ?? "a member",
    },
    success_url: `${APP_URL}/packs/${guildId}?powered=1`,
    cancel_url: `${APP_URL}/packs/${guildId}`,
  });

  return NextResponse.json({ url: checkout.url });
}
