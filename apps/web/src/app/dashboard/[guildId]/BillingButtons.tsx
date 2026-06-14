"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Currency = "INR" | "USD";

const PRICE: Record<Currency, { pro: string; studio: string }> = {
  USD: { pro: "$19/mo", studio: "$49/mo" },
  INR: { pro: "₹1600/mo", studio: "₹4100/mo" },
};

export function BillingButtons({
  guildId,
  isActive,
  managedInDiscord = false,
  defaultCurrency = "USD",
}: {
  guildId: string;
  isActive: boolean;
  /** Discord-entitlement-funded subs are managed in Discord. */
  managedInDiscord?: boolean;
  /** Geo-detected currency (server passes it); user may override below. */
  defaultCurrency?: Currency;
}) {
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);

  async function go(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        url?: string;
        cancelled?: boolean;
        error?: string;
      };
      if (data.url) window.location.href = data.url;
      else if (data.cancelled) window.location.reload();
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
        onClick={() => {
          if (confirm("Cancel this subscription at the end of the period?")) {
            void go("/api/billing/cancel", { guildId });
          }
        }}
      >
        Cancel subscription
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Currency:</span>
        {(["USD", "INR"] as Currency[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCurrency(c)}
            className={
              currency === c
                ? "rounded px-2 py-0.5 bg-fg/10 text-fg"
                : "rounded px-2 py-0.5 text-muted hover:text-fg"
            }
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => go("/api/checkout", { guildId, plan: "pro", currency })}
        >
          Upgrade to Pro — {PRICE[currency].pro}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            go("/api/checkout", { guildId, plan: "studio", currency })
          }
        >
          Studio — {PRICE[currency].studio}
        </Button>
      </div>
    </div>
  );
}
