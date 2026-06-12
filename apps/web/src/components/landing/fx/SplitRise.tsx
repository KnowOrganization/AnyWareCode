"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * Character-level masked rise for display headings. Splits into chars (nested
 * spans like `.text-outline` keep their styles), each char climbs out of its
 * own clip with a slight settle. autoSplit re-runs after webfonts load so
 * metrics never drift. Reduced motion leaves the heading static.
 */
export function SplitRise({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      SplitText.create(el, {
        type: "chars",
        mask: "chars",
        autoSplit: true,
        onSplit: (self) =>
          gsap.from(self.chars, {
            yPercent: 120,
            rotation: 4,
            duration: 0.9,
            ease: "power4.out",
            stagger: { each: 0.016, from: "start" },
            scrollTrigger: { trigger: el, start: "top 85%" },
          }),
      });
    },
    { scope: ref },
  );

  return (
    <span ref={ref} className={className ? `block ${className}` : "block"}>
      {children}
    </span>
  );
}
