import {
  listGuildInstallations,
  listPendingOssApplications,
} from "@anywarecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";
import { OssDecision } from "./OssDecision";

export const dynamic = "force-dynamic";

export default async function AdminOss() {
  const pending = await listPendingOssApplications(db);
  const rows = await Promise.all(
    pending.map(async (g) => ({
      guildId: g.id,
      accounts: (await listGuildInstallations(db, g.id)).map(
        (i) => i.accountLogin,
      ),
      appliedAt: g.ossAppliedAt?.toISOString().slice(0, 10) ?? "—",
    })),
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-semibold">OSS applications</h1>
      {rows.length === 0 ? (
        <GlassCard className="p-6 text-muted">
          No pending applications.
        </GlassCard>
      ) : (
        rows.map((r) => (
          <GlassCard
            key={r.guildId}
            className="flex flex-wrap items-center justify-between gap-3 p-5"
          >
            <div>
              <div className="font-mono text-sm">{r.guildId}</div>
              <div className="text-sm text-muted">
                GitHub: {r.accounts.join(", ") || "none"} · applied {r.appliedAt}
              </div>
            </div>
            <OssDecision guildId={r.guildId} />
          </GlassCard>
        ))
      )}
    </div>
  );
}
