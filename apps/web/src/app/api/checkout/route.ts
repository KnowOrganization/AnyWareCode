import { NextResponse } from "next/server";
import { getGuild, setGuildStripeCustomer } from "@anywherecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userManagesGuild } from "@/lib/guilds";
import { APP_URL, PRICE_IDS, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { guildId, plan } = (await req.json()) as {
    guildId?: string;
    plan?: "pro" | "team";
  };
  if (!guildId || (plan !== "pro" && plan !== "team")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await userManagesGuild(session.accessToken, guildId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const guild = await getGuild(db, guildId);
  if (!guild) {
    return NextResponse.json({ error: "Bot not installed" }, { status: 404 });
  }
  const price = PRICE_IDS[plan];
  if (!price) {
    return NextResponse.json({ error: "Plan not configured" }, { status: 500 });
  }

  const stripe = getStripe();
  let customerId = guild.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { guildId } });
    customerId = customer.id;
    await setGuildStripeCustomer(db, guildId, customerId);
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    metadata: { guildId },
    subscription_data: { metadata: { guildId } },
    success_url: `${APP_URL}/dashboard/${guildId}?upgraded=1`,
    cancel_url: `${APP_URL}/dashboard/${guildId}`,
  });

  return NextResponse.json({ url: checkout.url });
}
