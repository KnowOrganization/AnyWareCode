"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Masked line reveal for display type. Mark each line with `data-line` and
 * give it an `overflow-hidden` parent; lines rise out of the mask with a
 * stagger when the block scrolls into view.
 */
export function MaskRise({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(el.querySelectorAll("[data-line]"), {
        yPercent: 115,
        duration: 1.05,
        delay,
        ease: "power4.out",
        stagger: 0.12,
        scrollTrigger: { trigger: el, start: "top 88%" },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
