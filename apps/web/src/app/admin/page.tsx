import Link from "next/link";
import {
  countGuildsByTierAndStatus,
  listPendingOssApplications,
  packRevenueTotals,
} from "@anywherecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";
import { PLAN_PRICE } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <GlassCard className="p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
    </GlassCard>
  );
}

export default async function AdminDashboard() {
  const counts = await countGuildsByTierAndStatus(db);
  const pack = await packRevenueTotals(db);
  const pendingOss = (await listPendingOssApplications(db)).length;

  const total = counts.reduce((n, c) => n + c.n, 0);
  const active = counts.filter((c) => c.subStatus === "active");
  const trialing = counts
    .filter((c) => c.subStatus === "trialing")
    .reduce((n, c) => n + c.n, 0);
  // MRR estimate in USD (active paid guilds × USD plan price).
  const mrrCents = active.reduce((sum, c) => {
    const price =
      c.planId === "pro"
        ? PLAN_PRICE.pro.USD
        : c.planId === "studio"
          ? PLAN_PRICE.studio.USD
          : 0;
    return sum + price * c.n;
  }, 0);

  const byTier = (planId: string | null) =>
    counts.filter((c) => c.planId === planId).reduce((n, c) => n + c.n, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total servers" value={total} />
        <Stat label="MRR (est, USD)" value={`$${(mrrCents / 100).toFixed(0)}`} />
        <Stat
          label="Pack revenue (USD)"
          value={`$${(pack.totalCents / 100).toFixed(0)}`}
        />
        <Stat label="Trialing" value={trialing} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Pro servers" value={byTier("pro")} />
        <Stat label="Studio servers" value={byTier("studio")} />
        <Stat label="OSS servers" value={byTier("oss")} />
        <Stat label="Packs sold" value={pack.n} />
      </div>

      <GlassCard className="p-5">
        <div className="mb-3 font-display font-semibold">By tier &amp; status</div>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1">Tier</th>
              <th className="py-1">Status</th>
              <th className="py-1 text-right">Servers</th>
            </tr>
          </thead>
          <tbody>
            {counts
              .sort((a, b) => b.n - a.n)
              .map((c, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1">{c.planId ?? "—"}</td>
                  <td className="py-1">{c.subStatus}</td>
                  <td className="py-1 text-right">{c.n}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </GlassCard>

      {pendingOss > 0 && (
        <Link href="/admin/oss">
          <GlassCard hover className="p-5">
            <span className="font-medium text-primary">
              {pendingOss} OSS application{pendingOss === 1 ? "" : "s"} awaiting
              review →
            </span>
          </GlassCard>
        </Link>
      )}
    </div>
  );
}
