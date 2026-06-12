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
      {/* base radial wash — teal halo bleeding into near-black */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#0a2b27_0%,#091413_42%,#07090a_100%)]" />

      {/* drifting accent blobs — teal-dominant, one amber provenance stamp */}
      <div className="absolute -left-[10%] top-[-15%] h-[55vw] w-[55vw] rounded-full bg-teal/20 blur-[120px] animate-[drift_22s_ease-in-out_infinite]" />
      <div className="absolute right-[-15%] top-[8%] h-[50vw] w-[50vw] rounded-full bg-mint/14 blur-[130px] animate-[drift_26s_ease-in-out_infinite_reverse]" />
      <div className="absolute bottom-[-22%] left-[24%] h-[42vw] w-[42vw] rounded-full bg-amber/10 blur-[150px] animate-[drift_30s_ease-in-out_infinite]" />
      <div className="absolute left-[42%] top-[34%] h-[34vw] w-[34vw] rounded-full bg-teal/12 blur-[120px] animate-[drift_24s_ease-in-out_infinite_reverse]" />

      {/* dotted grid + audit scan lines + grain */}
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div className="bg-receipt absolute inset-0 opacity-40" />
      <div className="noise absolute inset-0 opacity-[0.04] mix-blend-overlay" />

      {/* fade to base at the bottom for clean section seams */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-bg" />
    </div>
  );
}
