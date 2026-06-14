"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";

interface Props {
  guildId: string;
  currentPlanId: string | null;
  updatedAt: string;
  plans: { id: string; name: string }[];
  suspended: boolean;
}

export function GuildAdminControls({
  guildId,
  currentPlanId,
  updatedAt,
  plans,
  suspended,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [planId, setPlanId] = useState(currentPlanId ?? "");
  const [packs, setPacks] = useState(50);

  async function call(
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guildId, expectedUpdatedAt: updatedAt, ...body }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setMsg("✅ Done.");
        router.refresh();
      } else {
        setMsg(`⚠️ ${data.error ?? "Failed"}`);
      }
    } catch {
      setMsg("⚠️ Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="space-y-5 p-5">
      <div className="font-display font-semibold">Controls</div>
      {msg && <div className="text-sm">{msg}</div>}

      {/* Set tier */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Tier:</span>
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 text-sm"
        >
          <option value="">(none / free)</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            call("/api/admin/guilds/" + guildId + "/tier", "POST", {
              planId: planId || null,
            })
          }
        >
          Set tier
        </Button>
      </div>

      {/* Pack grant/revoke */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Packs:</span>
        <input
          type="number"
          value={packs}
          onChange={(e) => setPacks(Number(e.target.value))}
          className="w-24 rounded-md border border-line bg-surface-2 px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            call("/api/admin/guilds/" + guildId, "PATCH", { packsDelta: packs })
          }
        >
          Grant
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            confirm(`Remove ${packs} pack tasks?`) &&
            call("/api/admin/guilds/" + guildId, "PATCH", {
              packsDelta: -Math.abs(packs),
              confirm: true,
            })
          }
        >
          Revoke
        </Button>
      </div>

      {/* Destructive row */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            confirm("Reset this server's monthly usage to 0?") &&
            call("/api/admin/guilds/" + guildId, "PATCH", {
              resetUsage: true,
              confirm: true,
            })
          }
        >
          Reset usage
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            call("/api/admin/guilds/" + guildId, "PATCH", {
              suspended: !suspended,
              confirm: true,
            })
          }
        >
          {suspended ? "Unsuspend" : "Suspend"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            confirm("Cancel this server's Razorpay subscription?") &&
            call("/api/admin/guilds/" + guildId + "/cancel", "POST", {
              confirm: true,
            })
          }
        >
          Cancel subscription
        </Button>
      </div>
    </GlassCard>
  );
}
