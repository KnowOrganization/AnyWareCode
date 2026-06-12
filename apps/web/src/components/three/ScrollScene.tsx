"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { scrollFx } from "@/lib/scrollFx";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** ssr:false keeps three.js out of the server bundle. */
const Scene = dynamic(() => import("./scene"), { ssr: false, loading: () => null });

/**
 * Fixed full-viewport WebGL layer behind the page content. Feeds page scroll
 * progress + pointer into `scrollFx` (read by the scene's frame loop) and
 * dims itself through the dense middle sections so text stays readable.
 */
export function ScrollScene() {
  const wrap = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = wrap.current;
      if (!el) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // Static finale view: whole graph lit, camera pulled back.
        scrollFx.progress = 0.999;
        gsap.set(el, { opacity: 0.6 });
        return;
      }

      const st = ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          scrollFx.progress = self.progress;
          scrollFx.velocity = self.getVelocity();
        },
      });

      // Bright in the hero, dimmed through the reading sections, back up for the CTA.
      const fade = gsap.fromTo(
        el,
        { opacity: 0.95 },
        {
          keyframes: [
            { opacity: 0.95, duration: 0 },
            { opacity: 0.4, duration: 0.25 },
            { opacity: 0.4, duration: 0.5 },
            { opacity: 0.85, duration: 0.25 },
          ],
          ease: "none",
          scrollTrigger: { start: 0, end: "max", scrub: 0.4 },
        },
      );

      const onMove = (e: PointerEvent) => {
        scrollFx.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
        scrollFx.pointerY = -((e.clientY / window.innerHeight) * 2 - 1);
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      return () => {
        window.removeEventListener("pointermove", onMove);
        st.kill();
        fade.scrollTrigger?.kill();
        fade.kill();
      };
    },
    { scope: wrap },
  );

  return (
    <div
      ref={wrap}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-[5]"
    >
      <Scene />
    </div>
  );
}
