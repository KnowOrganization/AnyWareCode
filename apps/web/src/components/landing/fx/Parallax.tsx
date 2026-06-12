"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scrubbed parallax drift while the element crosses the viewport.
 * `speed` is the total travel in px×0.01 of 160 (0.3 ≈ ±48px); negative
 * reverses direction. `axis="x"` drifts horizontally instead.
 */
export function Parallax({
  children,
  speed = 0.25,
  axis = "y",
  className,
}: {
  children: ReactNode;
  speed?: number;
  axis?: "x" | "y";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const travel = speed * 160;
      gsap.fromTo(
        el,
        { [axis]: travel },
        {
          [axis]: -travel,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        },
      );
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
