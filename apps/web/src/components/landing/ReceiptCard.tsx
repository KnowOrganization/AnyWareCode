"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const rows = [
  ["TASK", "#a1f3 — fix flaky retry test"],
  ["SPONSOR", "@mara · maintainer"],
  ["APPROVED", "plan v2 · 14:02 UTC"],
  ["STEERED BY", "@theo, @lin (thread)"],
  ["CHECKS", "typecheck ✓ · tests 42/42 ✓"],
  ["BRANCH", "anywherecode/a1f3"],
] as const;

/**
 * The hero artifact: a provenance receipt that prints line by line, then the
 * amber HUMAN-SPONSORED stamp slams on. Perforated edges via `.perf-y`.
 */
export function ReceiptCard() {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: "top 80%" },
      });
      tl.from(el.querySelectorAll("[data-row]"), {
        autoAlpha: 0,
        y: 10,
        duration: 0.32,
        stagger: 0.09,
        ease: "power2.out",
      }).from(
        el.querySelector("[data-stamp]"),
        {
          autoAlpha: 0,
          scale: 1.9,
          rotate: 8,
          duration: 0.45,
          ease: "back.out(2.2)",
        },
        "-=0.1",
      );
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="relative">
      <div className="perf-y bg-bg-soft px-6 pb-8 pt-7 sm:px-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
        <p data-row className="label-mono text-faint">
          ANYWARECODE — PROVENANCE RECEIPT
        </p>
        <div data-row className="rule-dash mt-4" />

        <dl className="mt-4 space-y-2.5 font-mono text-[0.8rem]">
          {rows.map(([k, v]) => (
            <div key={k} data-row className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 tracking-[0.14em] text-faint">{k}</dt>
              <dd className="truncate text-right text-fg/90">{v}</dd>
            </div>
          ))}
        </dl>

        <div data-row className="rule-dash mt-5" />
        <p data-row className="mt-4 font-mono text-[0.8rem] tracking-[0.06em]">
          <span className="text-primary">PR #128 OPENED</span>
          <span className="text-faint"> — awaiting human merge</span>
        </p>
        <div data-row aria-hidden className="barcode mt-5 h-9 text-fg/70" />
        <p data-row aria-hidden className="label-mono mt-2 text-faint">
          THREAD /threads/8841 · SIGNED BY THE SERVER
        </p>
      </div>

      <span
        data-stamp
        className="stamp absolute -right-2 top-10 -rotate-12 sm:-right-4"
      >
        Human-sponsored
      </span>
    </div>
  );
}
