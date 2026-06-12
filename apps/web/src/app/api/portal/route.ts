import { NextResponse } from "next/server";
import { getGuild } from "@anywherecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userManagesGuild } from "@/lib/guilds";
import { APP_URL, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

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
  const guild = await getGuild(db, guildId);
  if (!guild?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account yet" }, { status: 400 });
  }

  const portal = await getStripe().billingPortal.sessions.create({
    customer: guild.stripeCustomerId,
    return_url: `${APP_URL}/dashboard/${guildId}`,
  });

  return NextResponse.json({ url: portal.url });
}
