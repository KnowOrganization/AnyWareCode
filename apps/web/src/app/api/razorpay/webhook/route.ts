import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  applyGuildSubscription,
  findGuildByRazorpayCustomer,
  findPlanByRazorpayPlanId,
  getPlan,
  recordTaskPackPurchase,
  schema,
} from "@anywarecode/db";
import { db } from "@/lib/db";
import { PACK_TASKS, verifyWebhookSignature } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * The Razorpay rail's only write surface. Order mirrors the bot's webhook:
 * verify the raw-body signature, dedup the event id, then project subscription
 * lifecycle + pack events onto the guild's billing columns through the
 * packages/db choke points. Destructive writes pass `onlyIfSource` so a stale
 * Razorpay event can never clobber an "admin" override or the Discord rail.
 */
export async function POST(req: Request) {
  const sig = req.headers.get("x-razorpay-signature");
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }
  const raw = await req.text(); // raw body — do NOT req.json() before verifying
  if (!verifyWebhookSignature(raw, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(raw) as RazorpayEvent;
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  // Dedup: insert the event id; a replay inserts nothing and is acked as such.
  const eventId =
    req.headers.get("x-razorpay-event-id") ??
    event.payload?.payment?.entity?.id ??
    event.payload?.subscription?.entity?.id ??
    randomUUID();
  const inserted = await db
    .insert(schema.razorpayWebhookEvents)
    .values({ eventId, type: event.event })
    .onConflictDoNothing({ target: schema.razorpayWebhookEvents.eventId })
    .returning({ id: schema.razorpayWebhookEvents.eventId });
  if (inserted.length === 0) {
    return NextResponse.json({ duplicate: true });
  }

  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.updated":
    case "subscription.resumed": {
      await applyFromSubscription(event);
      break;
    }
    case "subscription.pending":
    case "subscription.halted":
    case "subscription.paused": {
      const guildId = await guildIdFor(event);
      if (guildId) {
        await applyGuildSubscription(
          db,
          guildId,
          { subStatus: "past_due" },
          { onlyIfSource: ["razorpay"] },
        );
      }
      break;
    }
    case "subscription.cancelled":
    case "subscription.completed": {
      const guildId = await guildIdFor(event);
      if (guildId) {
        // Drop to the Free floor (BYO-LLM), not to zero entitlements.
        const free = await getPlan(db, "free");
        await applyGuildSubscription(
          db,
          guildId,
          {
            subStatus: "free",
            subSource: null,
            razorpaySubscriptionId: null,
            planId: "free",
            taskCap: free?.taskCap ?? 15,
            concurrency: free?.concurrency ?? 1,
          },
          { onlyIfSource: ["razorpay", null] },
        );
      }
      break;
    }
    case "payment_link.paid":
    case "order.paid": {
      await creditPack(event);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

async function applyFromSubscription(event: RazorpayEvent): Promise<void> {
  const sub = event.payload?.subscription?.entity;
  if (!sub) return;
  const guildId = (await guildIdFor(event)) ?? null;
  if (!guildId) return;
  const plan = sub.plan_id
    ? await findPlanByRazorpayPlanId(db, sub.plan_id)
    : null;
  const subStatus = mapStatus(sub.status);
  await applyGuildSubscription(
    db,
    guildId,
    {
      razorpaySubscriptionId: sub.id ?? null,
      ...(sub.customer_id ? { razorpayCustomerId: sub.customer_id } : {}),
      subStatus,
      subSource: "razorpay",
      planId: plan?.id ?? null,
      ...(plan ? { taskCap: plan.taskCap, concurrency: plan.concurrency } : {}),
      currentPeriodEnd:
        typeof sub.current_end === "number"
          ? new Date(sub.current_end * 1000)
          : null,
    },
    // Activation may overwrite a fresh/razorpay row, never an admin/discord one.
    { onlyIfSource: ["razorpay", null] },
  );
}

async function creditPack(event: RazorpayEvent): Promise<void> {
  const entity =
    event.payload?.payment_link?.entity ?? event.payload?.order?.entity;
  const payment = event.payload?.payment?.entity;
  const notes = entity?.notes ?? payment?.notes;
  if (!notes || notes.kind !== "task_pack" || !notes.guildId) return;
  await recordTaskPackPurchase(db, {
    id: randomUUID(),
    guildId: notes.guildId,
    purchasedBy: notes.purchasedBy ?? "unknown",
    purchaserName: notes.purchaserName ?? "a member",
    tasks: PACK_TASKS,
    amountCents: entity?.amount ?? payment?.amount ?? 0,
    razorpayPaymentId: payment?.id ?? entity?.id ?? randomUUID(),
  });
}

function mapStatus(
  status: string | undefined,
): "active" | "past_due" | "canceled" | "free" {
  switch (status) {
    case "active":
    case "authenticated":
    case "resumed":
      return "active";
    case "pending":
    case "halted":
    case "paused":
      return "past_due";
    case "cancelled":
    case "completed":
    case "expired":
      return "canceled";
    default:
      return "free";
  }
}

async function guildIdFor(event: RazorpayEvent): Promise<string | null> {
  const sub = event.payload?.subscription?.entity;
  const noteGuild = sub?.notes?.guildId;
  if (noteGuild) return noteGuild;
  const custId = sub?.customer_id;
  if (custId) {
    const guild = await findGuildByRazorpayCustomer(db, custId);
    return guild?.id ?? null;
  }
  return null;
}

// Minimal shape of the Razorpay webhook payload we read.
interface RazorpayEvent {
  event: string;
  payload?: {
    subscription?: {
      entity?: {
        id?: string;
        plan_id?: string;
        customer_id?: string;
        status?: string;
        current_end?: number;
        notes?: Record<string, string>;
      };
    };
    payment?: {
      entity?: {
        id?: string;
        amount?: number;
        notes?: Record<string, string>;
      };
    };
    payment_link?: { entity?: PackEntity };
    order?: { entity?: PackEntity };
  };
}

interface PackEntity {
  id?: string;
  amount?: number;
  notes?: Record<string, string>;
}
