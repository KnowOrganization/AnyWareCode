import { notInArray } from "drizzle-orm";
import { createDb } from "./index.js";
import { plans } from "./schema.js";

/**
 * Idempotent plan seed. Run after creating the matching Stripe products:
 *   STRIPE_PRICE_PRO / STRIPE_PRICE_STUDIO hold the recurring price ids.
 * The Stripe webhook maps an incoming price id back to one of these rows.
 *
 * Trial is NOT a plan row — it's guilds.subStatus "trialing", maintained by
 * ensureGuild. The OSS row has no Stripe price; it's granted via the admin
 * OSS-approval route.
 */

const PLAN_ROWS = [
  {
    id: "oss",
    name: "OSS Community",
    taskCap: 30,
    concurrency: 1,
    stripePriceId: null as string | null,
    features: [
      "Verified public OSS servers",
      "Unlimited /ask on public repos",
      "Maintainer-gated runs",
    ],
    isDefault: false,
  },
  {
    id: "pro",
    name: "Pro",
    taskCap: 100,
    concurrency: 2,
    stripePriceId: process.env.STRIPE_PRICE_PRO ?? null,
    features: [
      "100 code tasks / mo",
      "2 concurrent tasks",
      "Server Memory",
      "Review agent",
      "scheduled_tasks",
    ],
    isDefault: false,
  },
  {
    id: "studio",
    name: "Studio",
    taskCap: 500,
    concurrency: 5,
    stripePriceId: process.env.STRIPE_PRICE_STUDIO ?? null,
    features: [
      "500 code tasks / mo",
      "5 concurrent tasks",
      "Standup Mode (voice)",
      "Spectate",
      "scheduled_tasks",
    ],
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
        concurrency: row.concurrency,
        stripePriceId: row.stripePriceId,
        features: row.features,
        isDefault: row.isDefault,
      },
    });
  console.log(`seeded plan ${row.id} (cap ${row.taskCap}, conc ${row.concurrency})`);
}
// Pre-launch cleanup: drop retired tiers (free/team) so stale rows can't match
// a Stripe price or show up in listPlans.
const kept = PLAN_ROWS.map((r) => r.id);
await db.delete(plans).where(notInArray(plans.id, kept));
await db.$client.end();
