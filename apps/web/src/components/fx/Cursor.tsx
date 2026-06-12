"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const INTERACTIVE =
  "a, button, [role='button'], input, textarea, select, [data-cursor]";

/**
 * Landing cursor — a teal dot that snaps to the pointer and a lagging ring
 * that breathes around it. The ring blooms over interactive targets and
 * contracts on press. Fine pointers only; native cursor is hidden via the
 * `awc-cursor` class on <html>.
 */
export function Cursor() {
  const [enabled, setEnabled] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ok =
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEnabled(ok);
  }, []);

  useGSAP(
    () => {
      if (!enabled) return;
      const el = root.current;
      if (!el) return;
      const dot = el.querySelector<HTMLElement>("[data-dot]");
      const ring = el.querySelector<HTMLElement>("[data-ring]");
      if (!dot || !ring) return;

      document.documentElement.classList.add("awc-cursor");
      gsap.set([dot, ring], { xPercent: -50, yPercent: -50, autoAlpha: 0 });

      const dotX = gsap.quickSetter(dot, "x", "px");
      const dotY = gsap.quickSetter(dot, "y", "px");
      const ringX = gsap.quickTo(ring, "x", { duration: 0.45, ease: "power3" });
      const ringY = gsap.quickTo(ring, "y", { duration: 0.45, ease: "power3" });
      const ringScale = gsap.quickTo(ring, "scale", {
        duration: 0.35,
        ease: "power3.out",
      });

      let seen = false;
      const move = (e: PointerEvent) => {
        if (!seen) {
          seen = true;
          gsap.set([dot, ring], { x: e.clientX, y: e.clientY });
          gsap.to([dot, ring], { autoAlpha: 1, duration: 0.25 });
        }
        dotX(e.clientX);
        dotY(e.clientY);
        ringX(e.clientX);
        ringY(e.clientY);
        const hot = (e.target as HTMLElement).closest?.(INTERACTIVE);
        ringScale(hot ? 2.1 : 1);
        ring.dataset.hot = hot ? "1" : "";
      };
      const down = () => ringScale(0.8);
      const up = (e: PointerEvent) =>
        ringScale((e.target as HTMLElement).closest?.(INTERACTIVE) ? 2.1 : 1);
      const leave = () => gsap.to([dot, ring], { autoAlpha: 0, duration: 0.2 });
      const enter = () => gsap.to([dot, ring], { autoAlpha: 1, duration: 0.2 });

      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerdown", down);
      window.addEventListener("pointerup", up);
      document.documentElement.addEventListener("pointerleave", leave);
      document.documentElement.addEventListener("pointerenter", enter);

      return () => {
        document.documentElement.classList.remove("awc-cursor");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerdown", down);
        window.removeEventListener("pointerup", up);
        document.documentElement.removeEventListener("pointerleave", leave);
        document.documentElement.removeEventListener("pointerenter", enter);
      };
    },
    { dependencies: [enabled] },
  );

  if (!enabled) return null;

  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-[130]">
      <div
        data-dot
        className="fixed left-0 top-0 size-2 rounded-full bg-primary mix-blend-difference"
      />
      <div
        data-ring
        className="fixed left-0 top-0 size-9 rounded-full border border-primary/70 transition-colors duration-200 data-[hot='1']:border-amber/80 data-[hot='1']:bg-primary/10"
      />
    </div>
  );
}
