import { createDb } from "./index.js";
import { plans } from "./schema.js";

/**
 * Idempotent plan seed. Run after creating the matching Stripe products:
 *   STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM hold the recurring price ids.
 * The Stripe webhook maps an incoming price id back to one of these rows.
 */

const PLAN_ROWS = [
  {
    id: "free",
    name: "Free",
    taskCap: Number(process.env.FREE_TASK_CAP ?? 5),
    stripePriceId: null as string | null,
    features: ["BYO LLM key", "Community support"],
    isDefault: true,
  },
  {
    id: "pro",
    name: "Pro",
    taskCap: 100,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    features: ["100 code tasks / mo", "BYO LLM key", "Priority queue"],
    isDefault: false,
  },
  {
    id: "team",
    name: "Team",
    taskCap: 500,
    stripePriceId: process.env.STRIPE_PRICE_TEAM ?? null,
    features: ["500 code tasks / mo", "BYO LLM key", "Priority support"],
    isDefault: false,
  },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed plans");

const db = createDb(url, process.env.DATABASE_SSL === "true");
for (const row of PLAN_ROWS) {
  await db
    .insert(plans)
    .values(row)
    .onConflictDoUpdate({
      target: plans.id,
      set: {
        name: row.name,
        taskCap: row.taskCap,
        stripePriceId: row.stripePriceId,
        features: row.features,
        isDefault: row.isDefault,
      },
    });
  console.log(`seeded plan ${row.id} (cap ${row.taskCap})`);
}
await db.$client.end();
