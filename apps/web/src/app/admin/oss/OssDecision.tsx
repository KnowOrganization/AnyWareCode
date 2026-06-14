"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function OssDecision({ guildId }: { guildId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/oss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guildId, approve }),
      });
      if (res.ok) router.refresh();
      else {
        const d = (await res.json()) as { error?: string };
        alert(d.error ?? "Failed");
        setBusy(false);
      }
    } catch {
      alert("Network error");
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={busy} onClick={() => decide(true)}>
        Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => decide(false)}
      >
        Reject
      </Button>
    </div>
  );
}
