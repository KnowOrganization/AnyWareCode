import { notInArray } from "drizzle-orm";
import { createDb } from "./index.js";
import { plans } from "./schema.js";

/**
 * Idempotent plan seed. Run after creating the matching Razorpay plans (one per
 * currency): RAZORPAY_PLAN_PRO_INR/USD, RAZORPAY_PLAN_STUDIO_INR/USD hold the
 * recurring plan ids. The Razorpay webhook maps an incoming plan id back to one
 * of these rows.
 *
 * Trial is NOT a plan row — it's guilds.subStatus "trialing", maintained by
 * ensureGuild. The OSS row has no Razorpay plan; it's granted via the admin
 * OSS-approval route.
 */

const PLAN_ROWS = [
  {
    id: "oss",
    name: "OSS Community",
    taskCap: 30,
    concurrency: 1,
    razorpayPlanIdInr: null as string | null,
    razorpayPlanIdUsd: null as string | null,
    features: [
      "Verified public OSS servers",
      "Unlimited /ask on public repos",
      "Maintainer-gated runs",
      "repro_gate",
      "verify_loop",
    ],
    isDefault: false,
  },
  {
    id: "pro",
    name: "Pro",
    taskCap: 100,
    concurrency: 2,
    razorpayPlanIdInr: process.env.RAZORPAY_PLAN_PRO_INR ?? null,
    razorpayPlanIdUsd: process.env.RAZORPAY_PLAN_PRO_USD ?? null,
    features: [
      "100 code tasks / mo",
      "2 concurrent tasks",
      "Server Memory",
      "Review agent",
      "scheduled_tasks",
      "repro_gate",
      "mcp_extensions",
      "verify_loop",
      "model_select",
    ],
    isDefault: false,
  },
  {
    id: "studio",
    name: "Studio",
    taskCap: 500,
    concurrency: 5,
    razorpayPlanIdInr: process.env.RAZORPAY_PLAN_STUDIO_INR ?? null,
    razorpayPlanIdUsd: process.env.RAZORPAY_PLAN_STUDIO_USD ?? null,
    features: [
      "500 code tasks / mo",
      "5 concurrent tasks",
      "Standup Mode (voice)",
      "Spectate",
      "scheduled_tasks",
      "repro_gate",
      "mcp_extensions",
      "squad_mode",
      "verify_loop",
      "model_select",
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
        razorpayPlanIdInr: row.razorpayPlanIdInr,
        razorpayPlanIdUsd: row.razorpayPlanIdUsd,
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
