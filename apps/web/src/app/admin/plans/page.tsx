import { listPlans } from "@anywarecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";
import { PlanEditor } from "./PlanEditor";

export const dynamic = "force-dynamic";

export default async function AdminPlans() {
  const plans = await listPlans(db);
  return (
    <div className="space-y-5">
      <GlassCard className="border-warning/40 p-4 text-sm">
        ⚠️ Editing a plan's cap/concurrency updates the plan row only. Existing
        servers keep their mirrored cap until their next subscription event or an
        admin <b>Set tier</b> on that server.
      </GlassCard>
      {plans
        .sort((a, b) => a.taskCap - b.taskCap)
        .map((p) => (
          <PlanEditor
            key={p.id}
            plan={{
              id: p.id,
              name: p.name,
              taskCap: p.taskCap,
              concurrency: p.concurrency,
              features: p.features,
              razorpayPlanIdInr: p.razorpayPlanIdInr,
              razorpayPlanIdUsd: p.razorpayPlanIdUsd,
            }}
          />
        ))}
    </div>
  );
}
