import Link from "next/link";
import { listPaymentsForUser, listPaymentsPaged } from "@anywarecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminPayments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = sp.user?.trim();
  const page = Math.max(0, Number(sp.page ?? "0") || 0);

  const rows = user
    ? await listPaymentsForUser(db, user)
    : (await listPaymentsPaged(db, PAGE_SIZE, page * PAGE_SIZE)).rows;
  const total = user
    ? rows.length
    : (await listPaymentsPaged(db, PAGE_SIZE, page * PAGE_SIZE)).total;

  return (
    <div className="space-y-5">
      <form className="flex gap-2" action="/admin/payments">
        <input
          name="user"
          defaultValue={user ?? ""}
          placeholder="Filter by purchaser Discord id…"
          className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm"
        />
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
              <th className="p-3">When</th>
              <th className="p-3">Server</th>
              <th className="p-3">Purchaser</th>
              <th className="p-3 text-right">Tasks</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 font-mono">Payment id</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line/60">
                <td className="p-3">{p.createdAt.toISOString().slice(0, 10)}</td>
                <td className="p-3">
                  <Link
                    href={`/admin/guilds/${p.guildId}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {p.guildId}
                  </Link>
                </td>
                <td className="p-3">{p.purchaserName}</td>
                <td className="p-3 text-right">{p.tasks}</td>
                <td className="p-3 text-right">
                  {(p.amountCents / 100).toFixed(2)}
                </td>
                <td className="p-3 font-mono text-xs">{p.razorpayPaymentId}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  No payments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </GlassCard>

      {!user && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{total} payments</span>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={`/admin/payments?page=${page - 1}`}
                className="rounded-md bg-surface-2 px-3 py-1.5 hover:bg-surface-3"
              >
                ← Prev
              </Link>
            )}
            {(page + 1) * PAGE_SIZE < total && (
              <Link
                href={`/admin/payments?page=${page + 1}`}
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
