"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import * as site from "@/lib/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Full-bleed command ticker — velocity-reactive: scroll speed accelerates the
 * tape and skews it, scrolling up runs it backwards, then it eases back to
 * cruise. Content duplicated once for the seamless -50% loop. Reduced motion
 * gets a static tape.
 */
export function Ticker() {
  const rowRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const row = rowRef.current;
      if (!row) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const tape = gsap.to(row, {
        xPercent: -50,
        ease: "none",
        duration: 32,
        repeat: -1,
      });
      const skewTo = gsap.quickTo(row, "skewX", {
        duration: 0.4,
        ease: "power2.out",
      });
      let unskew: gsap.core.Tween | null = null;

      const st = ScrollTrigger.create({
        onUpdate(self) {
          const v = self.getVelocity();
          const dir = v < 0 ? -1 : 1;
          gsap.to(tape, {
            timeScale: dir * gsap.utils.clamp(1, 6, 1 + Math.abs(v) / 350),
            duration: 0.2,
            overwrite: true,
            // glide back to cruise speed once the burst is applied
            onComplete: () =>
              void gsap.to(tape, { timeScale: dir, duration: 1.2 }),
          });
          skewTo(gsap.utils.clamp(-9, 9, v / 400));
          unskew?.kill();
          unskew = gsap.to(row, {
            skewX: 0,
            duration: 0.6,
            delay: 0.1,
            ease: "power2.out",
          });
        },
      });

      return () => {
        st.kill();
        tape.kill();
      };
    },
    { scope: rowRef },
  );

  const reel = (ariaHidden: boolean) => (
    <div
      aria-hidden={ariaHidden || undefined}
      className="flex shrink-0 items-center"
    >
      {site.commands.map(({ cmd, desc }) => (
        <span
          key={cmd}
          className="label-mono flex items-center whitespace-nowrap text-faint"
        >
          <span className="px-5 text-amber/70" aria-hidden>
            ✦
          </span>
          <span className="text-primary">{cmd}</span>
          <span className="pl-3 normal-case tracking-normal">{desc}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="ticker-mask overflow-hidden border-y border-line py-4">
      <div ref={rowRef} className="flex w-max">
        {reel(false)}
        {reel(true)}
      </div>
    </div>
  );
}
