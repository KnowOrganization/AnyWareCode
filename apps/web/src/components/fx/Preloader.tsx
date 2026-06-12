"use client";

import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { holdIntro, releaseIntro } from "@/lib/introGate";

gsap.registerPlugin(useGSAP);

const CHECKS = [
  "VERIFYING SPONSOR",
  "SEALING CONTAINER",
  "SCOPING TOKEN",
  "OPENING LEDGER",
] as const;

/**
 * Boot sequence — the ledger "prints" itself: counter runs 000→100 while the
 * custody checks stamp in, then the curtain lifts and hands off to the hero
 * choreography via the intro gate. Plays once per session; skipped entirely
 * under reduced motion.
 */
export function Preloader() {
  const [gone, setGone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Decide & hold before any sibling fx builds (tree order ⇒ effect order).
  useLayoutEffect(() => {
    if (
      sessionStorage.getItem("awc-intro") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setGone(true);
      return;
    }
    holdIntro();
  }, []);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || gone) return;

      document.documentElement.style.overflow = "hidden";
      const counter = el.querySelector("[data-counter]");
      const num = { v: 0 };

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => {
          sessionStorage.setItem("awc-intro", "1");
          setGone(true);
        },
      });

      tl.from("[data-boot-row]", {
        autoAlpha: 0,
        y: 14,
        stagger: 0.07,
        duration: 0.4,
      })
        .to(
          num,
          {
            v: 100,
            duration: 1.15,
            ease: "power2.inOut",
            onUpdate: () => {
              if (counter)
                counter.textContent = String(Math.round(num.v)).padStart(3, "0");
            },
          },
          0.1,
        )
        .to("[data-boot-bar]", { scaleX: 1, duration: 1.15, ease: "power2.inOut" }, 0.1)
        .from(
          "[data-boot-check]",
          { autoAlpha: 0, x: -10, stagger: 0.22, duration: 0.3 },
          0.25,
        )
        .from(
          "[data-boot-stamp]",
          { autoAlpha: 0, scale: 2.1, rotate: 10, duration: 0.4, ease: "back.out(2.2)" },
          ">-0.15",
        )
        .add(() => {
          // release just before the wipe so the hero rises as the curtain lifts
          document.documentElement.style.overflow = "";
          releaseIntro();
        }, "+=0.15")
        .to(el, {
          yPercent: -100,
          duration: 0.85,
          ease: "power4.inOut",
        });
    },
    { scope: ref, dependencies: [gone] },
  );

  if (gone) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="fixed inset-0 z-[120] flex flex-col justify-between bg-bg px-6 py-8 sm:px-12"
    >
      <div data-boot-row className="label-mono flex items-center justify-between text-faint">
        <span>
          ANYWARECODE — <span className="text-fg/80">LEDGER Nº 001</span>
        </span>
        <span className="hidden sm:inline">BOOT SEQUENCE</span>
      </div>

      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <div className="space-y-2.5">
            {CHECKS.map((c) => (
              <p key={c} data-boot-check className="label-mono text-faint">
                <span className="text-primary">✓</span> {c}
              </p>
            ))}
          </div>
          <span data-boot-stamp className="stamp mt-7 inline-block -rotate-6">
            Human-sponsored
          </span>
        </div>

        <p
          data-counter
          data-boot-row
          className="font-display text-[clamp(5rem,18vw,13rem)] font-bold leading-none tracking-tight text-outline-teal tabular-nums"
        >
          000
        </p>
      </div>

      <div data-boot-row>
        <div className="h-px w-full bg-line">
          <div
            data-boot-bar
            className="h-px origin-left scale-x-0 bg-primary"
          />
        </div>
        <div className="label-mono mt-3 flex items-center justify-between text-faint">
          <span>SIGNING MANIFEST</span>
          <span className="barcode inline-block h-4 w-28 text-fg/60" />
        </div>
      </div>
    </div>
  );
}
