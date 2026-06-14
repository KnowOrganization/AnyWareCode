import { notInArray } from "drizzle-orm";
import { createDb } from "./index.js";
import { plans } from "./schema.js";

/**
 * Idempotent plan seed. Run after creating the matching Razorpay plans (one per
 * currency): RAZORPAY_PLAN_PRO_INR/USD, RAZORPAY_PLAN_STUDIO_INR/USD hold the
 * recurring plan ids. The Razorpay webhook maps an incoming plan id back to one
 * of these rows.
 *
 * Every plan ships EVERY feature — plans differ only by the monthly /code cap
 * (and concurrency). So all four rows carry the same machine feature flags; the
 * only per-plan variation is the cap, concurrency, price, and display blurb.
 * Free is the default tier (BYO-LLM, no trial). The OSS row has no Razorpay
 * plan; it's granted via the admin OSS-approval route.
 */

/** Machine feature flags read by the bot's gates. Identical on every plan so
 * `planHasFeature` is true for any entitled guild. */
const ALL_FEATURE_FLAGS = [
  "scheduled_tasks",
  "repro_gate",
  "mcp_extensions",
  "verify_loop",
  "model_select",
  "squad_mode",
];

const PLAN_ROWS = [
  {
    id: "free",
    name: "Free",
    taskCap: 15,
    concurrency: 1,
    razorpayPlanIdInr: null as string | null,
    razorpayPlanIdUsd: null as string | null,
    features: ["15 code tasks / mo", "Unlimited /ask", "Everything included", ...ALL_FEATURE_FLAGS],
    isDefault: true,
  },
  {
    id: "oss",
    name: "OSS Community",
    taskCap: 40,
    concurrency: 1,
    razorpayPlanIdInr: null as string | null,
    razorpayPlanIdUsd: null as string | null,
    features: ["40 code tasks / mo", "Unlimited /ask", "Verified public OSS servers", ...ALL_FEATURE_FLAGS],
    isDefault: false,
  },
  {
    id: "pro",
    name: "Pro",
    taskCap: 150,
    concurrency: 2,
    razorpayPlanIdInr: process.env.RAZORPAY_PLAN_PRO_INR ?? null,
    razorpayPlanIdUsd: process.env.RAZORPAY_PLAN_PRO_USD ?? null,
    features: ["150 code tasks / mo", "Unlimited /ask", "2 concurrent tasks", "Everything included", ...ALL_FEATURE_FLAGS],
    isDefault: false,
  },
  {
    id: "studio",
    name: "Studio",
    taskCap: 600,
    concurrency: 5,
    razorpayPlanIdInr: process.env.RAZORPAY_PLAN_STUDIO_INR ?? null,
    razorpayPlanIdUsd: process.env.RAZORPAY_PLAN_STUDIO_USD ?? null,
    features: ["600 code tasks / mo", "Unlimited /ask", "5 concurrent tasks", "Everything included", ...ALL_FEATURE_FLAGS],
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
        razorpayPlanIdInr: row.razorpayPlanIdInr,
        razorpayPlanIdUsd: row.razorpayPlanIdUsd,
        features: row.features,
        isDefault: row.isDefault,
      },
    });
  console.log(`seeded plan ${row.id} (cap ${row.taskCap}, conc ${row.concurrency})`);
}
// Drop any retired tier rows so stale rows can't match a Razorpay plan or show
// up in listPlans. Current tiers: free, oss, pro, studio.
const kept = PLAN_ROWS.map((r) => r.id);
await db.delete(plans).where(notInArray(plans.id, kept));
await db.$client.end();
