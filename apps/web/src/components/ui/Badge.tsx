import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Small pill — eyebrow labels, "Most popular", status chips. */
export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium tracking-wide text-muted backdrop-blur",
        className,
      )}
    >
      {children}
    </span>
  );
}
