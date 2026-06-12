import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Frosted glass surface. `ring` adds the aurora hairline border;
 * `hover` adds a lift on hover.
 */
export function GlassCard({
  children,
  className,
  ring = false,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  ring?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass relative overflow-hidden",
        ring && "ring-aurora",
        hover &&
          "transition-all duration-300 hover:-translate-y-1 hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
