"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Hairline gradient bar across the top tracking page scroll. */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const el = bar.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.set(el, { scaleX: 0, transformOrigin: "0% 50%" });
    const setX = gsap.quickSetter(el, "scaleX");
    const st = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => setX(self.progress),
    });
    return () => st.kill();
  });

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[2px]"
    >
      <div
        ref={bar}
        className="h-full w-full bg-gradient-to-r from-indigo via-violet to-cyan shadow-[0_0_12px_rgba(139,92,246,0.8)]"
      />
    </div>
  );
}
