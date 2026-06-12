"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { introHeld, whenIntroDone } from "@/lib/introGate";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scroll-triggered entrance. Wrap a section/block; it fades + rises into view.
 * `stagger` animates direct children instead of the wrapper itself.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
  stagger = false,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  stagger?: boolean;
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const el = ref.current;
      if (!el || !contextSafe) return;
      // Respect reduced-motion: leave content fully visible, skip the reveal.
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const targets = stagger ? Array.from(el.children) : el;
      const build = contextSafe(() => {
        gsap.from(targets, {
          autoAlpha: 0,
          y,
          duration: 0.85,
          delay,
          ease: "power3.out",
          stagger: stagger ? 0.08 : 0,
          scrollTrigger: {
            trigger: el,
            start: "top 88%",
            toggleActions: once
              ? "play none none none"
              : "play none none reverse",
          },
        });
      });
      // Wait out the preloader so the entrance plays as the curtain lifts.
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
