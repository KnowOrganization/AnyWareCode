"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/cn";

gsap.registerPlugin(useGSAP);

/**
 * Pointer-tracked 3D tilt with a glare highlight that follows the cursor.
 * Wrap a card; the card keeps its own layout. Touch / reduced-motion: static.
 */
export function TiltCard({
  children,
  max = 7,
  className,
}: {
  children: ReactNode;
  /** Max tilt in degrees. */
  max?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (
        window.matchMedia("(hover: none)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }

      gsap.set(el, { transformPerspective: 900 });
      const rxTo = gsap.quickTo(el, "rotationX", { duration: 0.5, ease: "power2" });
      const ryTo = gsap.quickTo(el, "rotationY", { duration: 0.5, ease: "power2" });

      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        rxTo(-ny * max * 2);
        ryTo(nx * max * 2);
        el.style.setProperty("--gx", `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty("--gy", `${((e.clientY - r.top) / r.height) * 100}%`);
      };
      const leave = () => {
        rxTo(0);
        ryTo(0);
      };

      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      };
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={cn("group/tilt relative will-change-transform", className)}>
      {children}
      {/* cursor-following glare */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover/tilt:opacity-100"
        style={{
          background:
            "radial-gradient(340px circle at var(--gx,50%) var(--gy,50%), rgba(255,255,255,0.08), transparent 60%)",
        }}
      />
    </div>
  );
}
