"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/cn";

gsap.registerPlugin(useGSAP);

/**
 * Pointer-tracked 3D tilt with a sweeping glare. Wraps a card; the card leans
 * toward the cursor and a soft light band follows it. No-ops on touch and
 * under reduced motion.
 */
export function Tilt({
  children,
  className,
  max = 9,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = outer.current;
      if (!el) return;
      if (
        window.matchMedia("(hover: none)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const inner = el.querySelector<HTMLElement>("[data-tilt-inner]");
      const glare = el.querySelector<HTMLElement>("[data-tilt-glare]");
      if (!inner) return;

      const rx = gsap.quickTo(inner, "rotationX", { duration: 0.5, ease: "power3" });
      const ry = gsap.quickTo(inner, "rotationY", { duration: 0.5, ease: "power3" });

      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        rx(-py * max);
        ry(px * max);
        if (glare) {
          gsap.to(glare, {
            opacity: 0.5,
            x: px * r.width * 0.7,
            y: py * r.height * 0.7,
            duration: 0.4,
          });
        }
      };
      const leave = () => {
        rx(0);
        ry(0);
        if (glare) gsap.to(glare, { opacity: 0, duration: 0.5 });
      };

      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      };
    },
    { scope: outer },
  );

  return (
    <div ref={outer} className={cn("[perspective:900px]", className)}>
      <div
        data-tilt-inner
        className="relative [transform-style:preserve-3d] will-change-transform"
      >
        {children}
        <div
          data-tilt-glare
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0"
          style={{
            background:
              "radial-gradient(220px circle at 50% 40%, rgba(0,245,212,0.14), transparent 70%)",
          }}
        />
      </div>
    </div>
  );
}
