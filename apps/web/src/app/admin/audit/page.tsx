import Link from "next/link";
import { listAudit } from "@anywarecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? "0") || 0);
  const rows = await listAudit(db, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-semibold">Audit log</h1>
      <GlassCard className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              <th className="p-3">When</th>
              <th className="p-3">Actor</th>
              <th className="p-3">Action</th>
              <th className="p-3">Target</th>
              <th className="p-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-line/60 align-top">
                <td className="p-3 whitespace-nowrap">
                  {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="p-3 font-mono text-xs">{a.actorDiscordId}</td>
                <td className="p-3">{a.action}</td>
                <td className="p-3 font-mono text-xs">
                  {a.targetType}:{a.targetId}
                </td>
                <td className="p-3">
                  <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs text-muted">
                    {JSON.stringify(a.after ?? {}, null, 0)}
                  </pre>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </GlassCard>
      <div className="flex justify-end gap-2 text-sm">
        {page > 0 && (
          <Link
            href={`/admin/audit?page=${page - 1}`}
            className="rounded-md bg-surface-2 px-3 py-1.5 hover:bg-surface-3"
          >
            ← Prev
          </Link>
        )}
        {rows.length === PAGE_SIZE && (
          <Link
            href={`/admin/audit?page=${page + 1}`}
            className="rounded-md bg-surface-2 px-3 py-1.5 hover:bg-surface-3"
          >
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
