"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function BillingButtons({
  guildId,
  isActive,
}: {
  guildId: string;
  isActive: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function go(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else {
        alert(data.error ?? "Something went wrong.");
        setBusy(false);
      }
    } catch {
      alert("Network error.");
      setBusy(false);
    }
  }

  if (isActive) {
    return (
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => go("/api/portal", { guildId })}
      >
        Manage billing
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => go("/api/checkout", { guildId, plan: "pro" })}
      >
        Upgrade to Pro — $20/mo
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => go("/api/checkout", { guildId, plan: "team" })}
      >
        Team — $50/mo
      </Button>
    </div>
  );
}
