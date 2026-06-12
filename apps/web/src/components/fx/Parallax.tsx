"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scroll-scrubbed parallax exit. The wrapped block drifts upward (by
 * `speed` × viewport height) as its parent <section> scrolls out, optionally
 * fading. Layers with different speeds read as depth.
 */
export function Parallax({
  children,
  speed = 0.3,
  fade = false,
  className,
}: {
  children: ReactNode;
  speed?: number;
  fade?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const trigger = el.closest("section") ?? el;

      const vars: gsap.TweenVars = {
        y: () => -window.innerHeight * speed,
        ease: "none",
        scrollTrigger: {
          trigger,
          start: "top top",
          end: "bottom top",
          scrub: true,
          invalidateOnRefresh: true,
        },
      };
      if (fade) vars.autoAlpha = 0;
      gsap.to(el, vars);
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
