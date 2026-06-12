"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scrub-drawn chain of custody. As the section crosses the viewport, each
 * `[data-dot]` pops and the teal `[data-fill]` line draws to the next
 * station, in document order. The `scale` trick covers both geometries:
 * horizontal 1px-tall fills on lg, vertical 1px-wide fills on mobile.
 */
export function CustodyFx({
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
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // leave fills visible as plain rules
        gsap.set(el.querySelectorAll("[data-fill]"), { scale: 1 });
        return;
      }

      const dots = el.querySelectorAll("[data-dot]");
      const fills = el.querySelectorAll("[data-fill]");
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: el,
          start: "top 75%",
          end: "bottom 70%",
          scrub: 0.6,
        },
      });
      dots.forEach((dot, i) => {
        tl.from(dot, {
          scale: 0,
          duration: 0.25,
          ease: "back.out(3)",
        });
        const fill = fills[i];
        if (fill) {
          tl.fromTo(
            fill,
            { scale: 0, transformOrigin: "top left" },
            { scale: 1, duration: 1, ease: "none" },
          );
        }
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
