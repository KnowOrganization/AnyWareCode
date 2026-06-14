"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="ml-auto rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
    >
      Sign out
    </button>
  );
}
