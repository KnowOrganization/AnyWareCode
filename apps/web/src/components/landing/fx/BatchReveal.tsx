"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Per-row entrance for long lists: each direct child fades + rises as IT
 * enters the viewport, instead of the whole list animating at once like
 * `Reveal stagger`.
 */
export function BatchReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      for (const row of Array.from(el.children)) {
        gsap.from(row, {
          autoAlpha: 0,
          y: 26,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: row, start: "top 92%" },
        });
      }
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
