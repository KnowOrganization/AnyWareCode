"use client";

import { useMemo, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Container } from "@/components/ui/Container";

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface Word {
  text: string;
  accent: boolean;
}

/** Split copy into words; segments wrapped in [[double brackets]] go teal. */
function parse(text: string): Word[] {
  const words: Word[] = [];
  for (const seg of text.split(/(\[\[.*?\]\])/)) {
    if (!seg) continue;
    const accent = seg.startsWith("[[");
    const clean = accent ? seg.slice(2, -2) : seg;
    for (const w of clean.split(/\s+/)) {
      if (w) words.push({ text: w, accent });
    }
  }
  return words;
}

/**
 * Narrative connector between chapters — one oversized line whose words
 * brighten one at a time as it scrubs through the viewport, like a sentence
 * being read aloud. Markup renders at full color (SSR/reduced-motion safe);
 * the tween dims it and scrubs it back in.
 */
export function Interstitial({
  kicker,
  text,
}: {
  kicker?: string;
  text: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const words = useMemo(() => parse(text), [text]);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.fromTo(
        el.querySelectorAll("[data-w]"),
        { color: "rgba(237, 240, 240, 0.13)" },
        {
          color: (_i: number, t: Element) =>
            (t as HTMLElement).dataset.w === "1" ? "#00f5d4" : "#edf0f0",
          stagger: 0.08,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top 80%",
            end: "top 32%",
            scrub: 0.4,
          },
        },
      );
    },
    { scope: ref },
  );

  return (
    <section ref={ref} aria-label={text.replace(/\[\[|\]\]/g, "")} className="py-20 sm:py-28">
      <Container>
        {kicker ? (
          <p className="label-mono mb-6 text-faint">{kicker}</p>
        ) : null}
        <p
          aria-hidden
          className="max-w-4xl font-display text-[clamp(1.7rem,4.2vw,3.2rem)] font-semibold leading-[1.16] tracking-tight"
        >
          {words.map((w, i) => (
            <span key={i}>
              <span
                data-w={w.accent ? "1" : "0"}
                className={w.accent ? "text-primary" : "text-fg"}
              >
                {w.text}
              </span>{" "}
            </span>
          ))}
        </p>
      </Container>
    </section>
  );
}
