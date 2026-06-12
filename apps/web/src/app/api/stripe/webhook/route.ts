import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  applyGuildSubscription,
  findGuildByStripeCustomer,
  findPlanByStripePrice,
} from "@anywherecode/db";
import { db } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * The ONLY Stripe write surface. Verifies the signature, then projects
 * subscription lifecycle events onto the guild's billing columns. The bot reads
 * those columns for enforcement — it never talks to Stripe.
 */
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = getStripe();
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const guildId = s.metadata?.guildId;
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      if (guildId && subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        await applyFromSubscription(guildId, sub, customerId(sub.customer));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const guildId =
        sub.metadata?.guildId ?? (await guildIdFromCustomer(sub.customer));
      if (guildId) await applyFromSubscription(guildId, sub, customerId(sub.customer));
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const guildId = await guildIdFromCustomer(sub.customer);
      if (guildId) {
        await applyGuildSubscription(db, guildId, {
          subStatus: "canceled",
          stripeSubscriptionId: null,
          planId: null,
        });
      }
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const guildId = await guildIdFromCustomer(inv.customer);
      if (guildId) {
        await applyGuildSubscription(db, guildId, { subStatus: "past_due" });
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}

function customerId(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | undefined {
  if (!c) return undefined;
  return typeof c === "string" ? c : c.id;
}

async function guildIdFromCustomer(
  c: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  const id = customerId(c);
  if (!id) return null;
  const guild = await findGuildByStripeCustomer(db, id);
  return guild?.id ?? null;
}

async function applyFromSubscription(
  guildId: string,
  sub: Stripe.Subscription,
  custId: string | undefined,
): Promise<void> {
  const priceId = sub.items.data[0]?.price.id;
  const plan = priceId ? await findPlanByStripePrice(db, priceId) : null;
  const subStatus =
    sub.status === "active" || sub.status === "trialing"
      ? "active"
      : sub.status === "past_due"
        ? "past_due"
        : sub.status === "canceled" || sub.status === "unpaid"
          ? "canceled"
          : "free";
  await applyGuildSubscription(db, guildId, {
    stripeCustomerId: custId,
    stripeSubscriptionId: sub.id,
    subStatus,
    planId: plan?.id ?? null,
    ...(plan ? { taskCap: plan.taskCap } : {}),
    currentPeriodEnd: periodEnd(sub),
  });
}

// `current_period_end` sits on the subscription in older API versions and on
// the subscription item in newer ones; read whichever is present.
function periodEnd(sub: Stripe.Subscription): Date | null {
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const item = (sub.items.data[0] as unknown as { current_period_end?: number } | undefined)
    ?.current_period_end;
  const ts = top ?? item;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}
