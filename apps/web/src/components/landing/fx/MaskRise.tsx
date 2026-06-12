"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { introHeld, whenIntroDone } from "@/lib/introGate";

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
    (_, contextSafe) => {
      const el = ref.current;
      if (!el || !contextSafe) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const build = contextSafe(() => {
        gsap.from(el.querySelectorAll("[data-line]"), {
          yPercent: 115,
          duration: 1.05,
          delay,
          ease: "power4.out",
          stagger: 0.12,
          scrollTrigger: { trigger: el, start: "top 88%" },
        });
      });
      if (introHeld()) whenIntroDone(build);
      else build();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
