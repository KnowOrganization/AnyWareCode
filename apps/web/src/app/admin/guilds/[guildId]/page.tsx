import Link from "next/link";
import {
  getGuild,
  listAudit,
  listPaymentsForGuild,
  listPlans,
} from "@anywherecode/db";
import { db } from "@/lib/db";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { GuildAdminControls } from "./GuildAdminControls";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

export default async function AdminGuildDetail({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const guild = await getGuild(db, guildId);
  if (!guild) {
    return (
      <GlassCard className="p-6">
        <p className="text-muted">
          No such server.{" "}
          <Link href="/admin/guilds" className="text-primary">
            Back to list
          </Link>
        </p>
      </GlassCard>
    );
  }
  const [plans, payments, audit] = await Promise.all([
    listPlans(db),
    listPaymentsForGuild(db, guildId),
    listAudit(db, { targetType: "guild", targetId: guildId, limit: 25, offset: 0 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/guilds" className="text-sm text-muted hover:text-fg">
          ← Servers
        </Link>
        <h1 className="font-mono text-lg">{guild.id}</h1>
        {guild.suspended && <Badge>suspended</Badge>}
      </div>

      <GlassCard className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <Field label="Tier" value={guild.planId ?? "—"} />
        <Field label="Status" value={guild.subStatus} />
        <Field label="Source" value={guild.subSource ?? "—"} />
        <Field label="Task cap" value={guild.taskCap} />
        <Field label="Concurrency" value={guild.concurrency} />
        <Field
          label="Used (code / ask)"
          value={`${guild.tasksUsedThisMonth} / ${guild.asksUsedThisMonth}`}
        />
        <Field label="Packs left" value={guild.packTasksRemaining} />
        <Field
          label="Period end"
          value={guild.currentPeriodEnd?.toISOString().slice(0, 10)}
        />
        <Field
          label="Trial ends"
          value={guild.trialEndsAt?.toISOString().slice(0, 10)}
        />
        <Field
          label="Razorpay sub"
          value={
            <span className="font-mono text-xs">
              {guild.razorpaySubscriptionId ?? "—"}
            </span>
          }
        />
      </GlassCard>

      <GuildAdminControls
        guildId={guild.id}
        currentPlanId={guild.planId}
        updatedAt={guild.updatedAt.toISOString()}
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        suspended={guild.suspended}
      />

      <GlassCard className="p-5">
        <div className="mb-3 font-display font-semibold">Pack purchases</div>
        {payments.length === 0 ? (
          <p className="text-sm text-muted">No purchases.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1">When</th>
                <th className="py-1">By</th>
                <th className="py-1 text-right">Tasks</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1">
                    {p.createdAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-1">{p.purchaserName}</td>
                  <td className="py-1 text-right">{p.tasks}</td>
                  <td className="py-1 text-right">
                    {(p.amountCents / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-3 font-display font-semibold">Recent admin actions</div>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">No audit entries.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="border-t border-line py-1">
                <span className="text-muted">
                  {a.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>{" "}
                — <span className="font-medium">{a.action}</span> by{" "}
                <span className="font-mono text-xs">{a.actorDiscordId}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
