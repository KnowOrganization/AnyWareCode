"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function PackBuyButton({ guildId }: { guildId: string }) {
  const [busy, setBusy] = useState(false);

  async function buy() {
    setBusy(true);
    try {
      const res = await fetch("/api/checkout/pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guildId }),
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

  return (
    <Button variant="primary" disabled={busy} onClick={buy}>
      Power this server — $10 / 50 tasks 🔋
    </Button>
  );
}
