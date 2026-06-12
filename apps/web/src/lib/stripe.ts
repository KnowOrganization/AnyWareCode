import Stripe from "stripe";

// Lazy so an unset key doesn't throw at build/import time — only when used.
let client: Stripe | null = null;
export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

export const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO ?? "",
  studio: process.env.STRIPE_PRICE_STUDIO ?? "",
};

/** One-time price for the $10 / 50-task pack. */
export const PACK_PRICE_ID = process.env.STRIPE_PRICE_PACK ?? "";
export const PACK_TASKS = 50;

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
