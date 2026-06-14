import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/ui/Container";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/guilds", label: "Servers" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/oss", label: "OSS" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/audit", label: "Audit" },
];

/** The single UI gate for the whole /admin subtree. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    redirect("/dashboard");
  }
  return (
    <PageShell>
      <Container>
        <div className="mb-8 flex flex-wrap items-center gap-2 border-b border-line pb-4">
          <span className="mr-4 font-display text-lg font-semibold">Admin</span>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
            >
              {n.label}
            </Link>
          ))}
        </div>
        {children}
      </Container>
    </PageShell>
  );
}
