"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/cn";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * A hairline that draws itself (scaleX 0 → 1) when scrolled into view.
 * Under reduced motion it simply renders as a static rule.
 */
export function DrawLine({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.fromTo(
        el,
        { scaleX: 0 },
        {
          scaleX: 1,
          duration: 1.2,
          ease: "power3.inOut",
          scrollTrigger: { trigger: el, start: "top 92%" },
        },
      );
    },
    { scope: ref },
  );

  return (
    <div ref={ref} aria-hidden className={cn("h-px origin-left bg-line", className)} />
  );
}
