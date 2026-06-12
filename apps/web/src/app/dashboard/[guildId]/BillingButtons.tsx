"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function BillingButtons({
  guildId,
  isActive,
  managedInDiscord = false,
}: {
  guildId: string;
  isActive: boolean;
  /** Discord-entitlement-funded subs have no Stripe portal. */
  managedInDiscord?: boolean;
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

  if (isActive && managedInDiscord) {
    return (
      <p className="text-sm text-muted">
        💳 This subscription is managed in Discord — open Server Settings →
        App Subscriptions there to change it.
      </p>
    );
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
        onClick={() => go("/api/checkout", { guildId, plan: "studio" })}
      >
        Studio — $50/mo
      </Button>
    </div>
  );
}
