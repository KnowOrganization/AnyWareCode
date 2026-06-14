"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Company admin sign-in. Email + password only — no social providers and no
 * signup (admin accounts are provisioned in Supabase by an operator). The
 * ADMIN_EMAILS allowlist is enforced server-side by requireAdmin.
 */
export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7"
      >
        <h1 className="font-display text-2xl font-semibold">Admin sign-in</h1>
        <p className="mt-1 text-sm text-muted">Company operators only.</p>

        <label className="mt-6 block text-sm text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
        />

        <label className="mt-4 block text-sm text-muted" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
        />

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-bg disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
