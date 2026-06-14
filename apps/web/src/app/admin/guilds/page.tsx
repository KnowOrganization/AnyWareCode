import Link from "next/link";
import { listGuildsPaged, searchGuilds, type Guild } from "@anywarecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUSES = ["free", "active", "past_due", "canceled"] as const;

export default async function AdminGuilds({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = STATUSES.includes(sp.status as never)
    ? (sp.status as (typeof STATUSES)[number])
    : undefined;
  const sort = sp.sort === "usage" ? "usage" : "recent";
  const page = Math.max(0, Number(sp.page ?? "0") || 0);

  let rows: Guild[];
  let total: number;
  if (q) {
    rows = await searchGuilds(db, q, PAGE_SIZE);
    total = rows.length;
  } else {
    const res = await listGuildsPaged(db, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      status,
      sort,
    });
    rows = res.rows;
    total = res.total;
  }

  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    if (sort !== "recent") p.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== "") p.set(k, String(v));
    }
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-center gap-2" action="/admin/guilds">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name or id…"
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm"
        >
          <option value="recent">Newest</option>
          <option value="usage">Top usage</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-3"
        >
          Filter
        </button>
      </form>

      <GlassCard className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              <th className="p-3">Server</th>
              <th className="p-3">Tier</th>
              <th className="p-3">Status</th>
              <th className="p-3">Source</th>
              <th className="p-3 text-right">Used / Cap</th>
              <th className="p-3 text-right">Packs</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="border-b border-line/60">
                <td className="p-3">
                  <div className="font-medium">{g.name ?? "—"}</div>
                  <div className="font-mono text-xs text-muted">{g.id}</div>
                </td>
                <td className="p-3">{g.planId ?? "—"}</td>
                <td className="p-3">
                  {g.suspended ? <Badge>suspended</Badge> : g.subStatus}
                </td>
                <td className="p-3 text-muted">{g.subSource ?? "—"}</td>
                <td className="p-3 text-right">
                  {g.tasksUsedThisMonth} / {g.taskCap}
                </td>
                <td className="p-3 text-right">{g.packTasksRemaining}</td>
                <td className="p-3 text-right">
                  <Link
                    href={`/admin/guilds/${g.id}`}
                    className="text-primary hover:underline"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  No servers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </GlassCard>

      {!q && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {total} servers · page {page + 1} of{" "}
            {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={`/admin/guilds${qs({ page: page - 1 })}`}
                className="rounded-md bg-surface-2 px-3 py-1.5 hover:bg-surface-3"
              >
                ← Prev
              </Link>
            )}
            {(page + 1) * PAGE_SIZE < total && (
              <Link
                href={`/admin/guilds${qs({ page: page + 1 })}`}
                className="rounded-md bg-surface-2 px-3 py-1.5 hover:bg-surface-3"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
