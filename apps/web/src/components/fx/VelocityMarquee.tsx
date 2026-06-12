"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/cn";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Infinite marquee that reacts to scroll: scrolling speeds it up (and reverses
 * it when scrolling up) and skews the track with velocity, then it eases back
 * to a slow drift. `children` is ONE set of items — it's rendered twice for a
 * seamless -50% loop.
 */
export function VelocityMarquee({
  children,
  duration = 30,
  className,
}: {
  children: ReactNode;
  /** Seconds for one full loop at rest. */
  duration?: number;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = track.current;
      if (!el) return;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reduced) return; // static row

      const loop = gsap.to(el, {
        xPercent: -50,
        ease: "none",
        duration,
        repeat: -1,
      });
      const skewTo = gsap.quickTo(el, "skewX", { duration: 0.4, ease: "power3" });

      let settle: gsap.core.Tween | null = null;
      const st = ScrollTrigger.create({
        onUpdate: (self) => {
          const v = self.getVelocity();
          // scroll down → faster forward; scroll up → runs backward
          loop.timeScale(gsap.utils.clamp(-5, 5, 1 + v / 350));
          skewTo(gsap.utils.clamp(-10, 10, v / 160));
          settle?.kill();
          settle = gsap.to(loop, {
            timeScale: 1,
            duration: 0.9,
            delay: 0.15,
            ease: "power2.out",
            onStart: () => skewTo(0),
          });
        },
      });

      return () => {
        st.kill();
        settle?.kill();
        loop.kill();
      };
    },
    { scope: track },
  );

  return (
    <div ref={track} className={cn("flex w-max will-change-transform", className)}>
      {children}
      {children}
    </div>
  );
}
