"use client";

import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";

/**
 * Beta waitlist capture. POSTs an email to /api/waitlist; ledger-styled to
 * match the Receipts till above it. No auth — public landing form.
 */
export function Waitlist() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, source: "landing" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Something went wrong. Try again.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <section id="waitlist" className="relative py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="perf-y mx-auto max-w-2xl bg-bg-soft px-7 py-10 text-center">
            <p className="label-mono text-faint">
              STUB / <span className="text-primary">Beta waitlist</span>
            </p>
            <h3 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Free while we&apos;re in beta.
            </h3>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted">
              Every plan is $0 during the beta. Drop your email and we&apos;ll
              send your invite.
            </p>

            {done ? (
              <p className="mt-8 font-mono text-sm text-primary" role="status">
                ✓ You&apos;re on the list. Watch your inbox.
              </p>
            ) : (
              <form
                onSubmit={onSubmit}
                className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row"
              >
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@studio.dev"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-on-primary disabled:opacity-60"
                >
                  {busy ? "Joining…" : "Join waitlist"}
                </button>
              </form>
            )}

            {error && (
              <p className="mt-4 text-sm text-red-400" role="alert">
                {error}
              </p>
            )}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
