import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "solid" | "outline" | "bare";

const base =
  "group/cta inline-flex h-12 items-center justify-center gap-2.5 rounded-[0.3rem] px-6 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const variants: Record<Variant, string> = {
  solid:
    "bg-primary text-on-primary hover:-translate-y-0.5 hover:shadow-[0_16px_44px_-14px_rgba(0,245,212,0.55)]",
  outline:
    "border border-line-strong text-fg hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface",
  bare: "px-2 text-muted hover:text-fg",
};

/**
 * Ledger CTA — squared, mono, uppercase. The landing page's button voice;
 * the dashboard keeps the rounded glass `Button`.
 */
export function Cta({
  href,
  variant = "solid",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(base, variants[variant], className);
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
