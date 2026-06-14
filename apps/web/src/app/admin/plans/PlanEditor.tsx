"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";

interface PlanDto {
  id: string;
  name: string;
  taskCap: number;
  concurrency: number;
  features: string[];
  razorpayPlanIdInr: string | null;
  razorpayPlanIdUsd: string | null;
}

export function PlanEditor({ plan }: { plan: PlanDto }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [taskCap, setTaskCap] = useState(plan.taskCap);
  const [concurrency, setConcurrency] = useState(plan.concurrency);
  const [inr, setInr] = useState(plan.razorpayPlanIdInr ?? "");
  const [usd, setUsd] = useState(plan.razorpayPlanIdUsd ?? "");
  const [features, setFeatures] = useState(plan.features.join("\n"));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/plans/${plan.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          taskCap,
          concurrency,
          razorpayPlanIdInr: inr || null,
          razorpayPlanIdUsd: usd || null,
          features: features.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setMsg(res.ok && data.ok ? "✅ Saved." : `⚠️ ${data.error ?? "Failed"}`);
      if (res.ok) router.refresh();
    } catch {
      setMsg("⚠️ Network error.");
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-md border border-line bg-surface-2 px-2 py-1 text-sm";

  return (
    <GlassCard className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div className="font-display font-semibold">
          {plan.name}{" "}
          <span className="font-mono text-xs text-muted">({plan.id})</span>
        </div>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="text-muted">Task cap</span>
          <input
            type="number"
            value={taskCap}
            onChange={(e) => setTaskCap(Number(e.target.value))}
            className={`mt-1 w-full ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Concurrency</span>
          <input
            type="number"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            className={`mt-1 w-full ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Razorpay plan (INR)</span>
          <input
            value={inr}
            onChange={(e) => setInr(e.target.value)}
            className={`mt-1 w-full ${field}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Razorpay plan (USD)</span>
          <input
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
            className={`mt-1 w-full ${field}`}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="text-muted">Features (one per line)</span>
        <textarea
          value={features}
          onChange={(e) => setFeatures(e.target.value)}
          rows={4}
          className={`mt-1 w-full font-mono text-xs ${field}`}
        />
      </label>
      <Button size="sm" disabled={busy} onClick={save}>
        Save plan
      </Button>
    </GlassCard>
  );
}
