import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";

// Lazy so an unset key doesn't throw at build/import time — only when used.
let client: Razorpay | null = null;
export function getRazorpay(): Razorpay {
  if (!client) {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
      throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set");
    }
    client = new Razorpay({ key_id, key_secret });
  }
  return client;
}

/** Whether Razorpay is configured at all (gates server-side cancel etc.). */
export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export type Currency = "INR" | "USD";
export type Tier = "pro" | "studio";

/** tier → { INR planId, USD planId }. Two Razorpay plans per tier. */
export const PLAN_IDS: Record<Tier, Record<Currency, string>> = {
  pro: {
    INR: process.env.RAZORPAY_PLAN_PRO_INR ?? "",
    USD: process.env.RAZORPAY_PLAN_PRO_USD ?? "",
  },
  studio: {
    INR: process.env.RAZORPAY_PLAN_STUDIO_INR ?? "",
    USD: process.env.RAZORPAY_PLAN_STUDIO_USD ?? "",
  },
};

/** One-time task-pack amounts in the smallest unit (paise / cents). */
export const PACK_AMOUNTS: Record<Currency, number> = {
  INR: Number(process.env.RAZORPAY_PACK_AMOUNT_INR ?? "70000"), // ₹700
  USD: Number(process.env.RAZORPAY_PACK_AMOUNT_USD ?? "800"), //  $8
};

/** Monthly subscription price per tier+currency (smallest unit) — for the
 * admin MRR estimate + display. Mirrors the Razorpay plan amounts. */
export const PLAN_PRICE: Record<Tier, Record<Currency, number>> = {
  pro: { INR: 160000, USD: 1900 }, // ₹1600 / $19
  studio: { INR: 410000, USD: 4900 }, // ₹4100 / $49
};

export const PACK_TASKS = 50;
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

/** Create a Razorpay subscription and return its hosted-checkout short_url.
 * The webhook is the source of truth; we resolve the guild from `notes`. */
export async function createSubscriptionUrl(
  guildId: string,
  plan: Tier,
  currency: Currency,
): Promise<string> {
  const planId = PLAN_IDS[plan][currency];
  if (!planId) throw new Error(`Plan not configured for ${currency}`);
  const sub = (await getRazorpay().subscriptions.create({
    plan_id: planId,
    total_count: 120, // ~10 years of monthly cycles = "until cancelled"
    customer_notify: 1,
    notes: { guildId, plan },
  })) as { short_url?: string };
  if (!sub.short_url) throw new Error("Could not start subscription checkout");
  return sub.short_url;
}

/** Create a one-time Razorpay payment link for a Job Pack; returns short_url.
 * The pack belongs to the server; the buyer is credited publicly via `notes`. */
export async function createPackUrl(opts: {
  guildId: string;
  currency: Currency;
  buyerId?: string;
  buyerName?: string;
}): Promise<string> {
  // The SDK's create types are over-constrained; pass a loose body.
  const createLink = getRazorpay().paymentLink.create as unknown as (
    body: Record<string, unknown>,
  ) => Promise<{ short_url?: string }>;
  const link = await createLink({
    amount: PACK_AMOUNTS[opts.currency],
    currency: opts.currency,
    accept_partial: false,
    notes: {
      kind: "task_pack",
      guildId: opts.guildId,
      purchasedBy: opts.buyerId ?? "unknown",
      purchaserName: opts.buyerName ?? "a member",
    },
    // Webhook credits + the bot's pack-announcer posts the public thank-you, so
    // the buyer just lands back on the marketing site.
    callback_url: APP_URL,
    callback_method: "get",
  });
  if (!link.short_url) throw new Error("Could not start pack checkout");
  return link.short_url;
}

/** Pack-attribution token, signed by the bot and verified here, so a shared
 * /pay link can't be forged to credit someone else. Payload: guild/buyer/exp. */
export interface PackToken {
  g: string; // guildId
  u: string; // buyer discord id
  n: string; // buyer display name
  e: number; // expiry (epoch ms)
}

function billingSecret(): string {
  const s = process.env.BILLING_BRIDGE_SECRET;
  if (!s) throw new Error("BILLING_BRIDGE_SECRET not set");
  return s;
}

export function verifyPackToken(token: string): PackToken | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", billingSecret())
      .update(body)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as PackToken;
    if (typeof payload.e !== "number" || Date.now() > payload.e) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Auto-detect the buyer's currency from the request, INR for India else USD. */
export function currencyFor(req: Request): Currency {
  const country = (
    req.headers.get("x-vercel-ip-country") ??
    req.headers.get("cf-ipcountry") ??
    ""
  ).toUpperCase();
  return country === "IN" ? "INR" : "USD";
}

/** Coerce a client-supplied override to a valid currency, else fall back. */
export function resolveCurrency(
  override: unknown,
  fallback: Currency,
): Currency {
  return override === "INR" || override === "USD" ? override : fallback;
}

/**
 * Razorpay webhook signature = HMAC-SHA256(raw body, webhook secret), hex.
 * Must be computed over the RAW request body (before JSON parse). Mirrors the
 * timing-safe pattern in apps/bot/src/github/state.ts.
 */
export function verifyWebhookSignature(
  raw: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
