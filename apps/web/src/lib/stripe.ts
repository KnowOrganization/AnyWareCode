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
  team: process.env.STRIPE_PRICE_TEAM ?? "",
};

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
