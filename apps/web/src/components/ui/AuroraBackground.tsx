import { cn } from "@/lib/cn";

/**
 * Fixed, full-viewport aurora gradient blobs + dotted grid + grain.
 * Render once at the page root, behind everything (z-negative).
 */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {/* base radial wash */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#13123a_0%,#080814_45%,#06060d_100%)]" />

      {/* drifting aurora blobs */}
      <div className="absolute -left-[10%] top-[-15%] h-[55vw] w-[55vw] rounded-full bg-violet/30 blur-[120px] animate-[drift_22s_ease-in-out_infinite]" />
      <div className="absolute right-[-15%] top-[10%] h-[50vw] w-[50vw] rounded-full bg-cyan/20 blur-[130px] animate-[drift_26s_ease-in-out_infinite_reverse]" />
      <div className="absolute bottom-[-20%] left-[20%] h-[45vw] w-[45vw] rounded-full bg-pink/20 blur-[140px] animate-[drift_30s_ease-in-out_infinite]" />
      <div className="absolute left-[40%] top-[35%] h-[35vw] w-[35vw] rounded-full bg-blurple/20 blur-[120px] animate-[drift_24s_ease-in-out_infinite_reverse]" />

      {/* dotted grid + grain */}
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div className="noise absolute inset-0 opacity-[0.04] mix-blend-overlay" />

      {/* fade to base at the bottom for clean section seams */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-bg" />
    </div>
  );
}
