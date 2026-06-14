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
