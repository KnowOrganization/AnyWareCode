import { NextResponse } from "next/server";
import { getGuild } from "@anywarecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userManagesGuild } from "@/lib/guilds";
import {
  PLAN_IDS,
  currencyFor,
  getRazorpay,
  resolveCurrency,
} from "@/lib/razorpay";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { guildId, plan, currency } = (await req.json()) as {
    guildId?: string;
    plan?: "pro" | "studio";
    currency?: string;
  };
  if (!guildId || (plan !== "pro" && plan !== "studio")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await userManagesGuild(session.accessToken, guildId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const guild = await getGuild(db, guildId);
  if (!guild) {
    return NextResponse.json({ error: "Bot not installed" }, { status: 404 });
  }

  const cur = resolveCurrency(currency, currencyFor(req));
  const planId = PLAN_IDS[plan][cur];
  if (!planId) {
    return NextResponse.json(
      { error: `Plan not configured for ${cur}` },
      { status: 500 },
    );
  }

  // Razorpay subscription → hosted checkout (short_url). The webhook is the
  // source of truth for the sub/customer ids; we resolve the guild from notes.
  const sub = (await getRazorpay().subscriptions.create({
    plan_id: planId,
    total_count: 120, // ~10 years of monthly cycles = "until cancelled"
    customer_notify: 1,
    notes: { guildId, plan },
  })) as { short_url?: string };

  if (!sub.short_url) {
    return NextResponse.json(
      { error: "Could not start checkout" },
      { status: 502 },
    );
  }
  return NextResponse.json({ url: sub.short_url });
}
