"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

interface Seg {
  t: string;
  c: string;
}
interface LineDef {
  who?: string;
  segs: Seg[];
}

const LINES: LineDef[] = [
  {
    who: "you",
    segs: [
      { t: "/code", c: "text-cyan" },
      { t: " add dark-mode toggle", c: "text-fg" },
    ],
  },
  {
    segs: [
      { t: "→ ", c: "text-cyan" },
      { t: "opened thread ", c: "text-muted" },
      { t: "#task-128", c: "text-fg" },
    ],
  },
  {
    segs: [
      { t: "→ ", c: "text-cyan" },
      { t: "pushed ", c: "text-muted" },
      { t: "anywherecode/ab12cd", c: "text-fg" },
    ],
  },
  {
    segs: [
      { t: "✓ ", c: "text-mint" },
      { t: "opened PR ", c: "text-muted" },
      { t: "#128", c: "text-fg" },
    ],
  },
];

const lineChars = (l: LineDef) =>
  l.segs.reduce((n, s) => n + s.t.length, 0) + (l.who?.length ?? 0);

/**
 * Glass Discord/terminal window that types its task → PR flow when scrolled
 * into view. Click anywhere on it to replay.
 */
export function TerminalDemo() {
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const lines = gsap.utils.toArray<HTMLElement>("[data-tline]", el);
      const caret = el.querySelector("[data-caret]");
      gsap.set(lines, { clipPath: "inset(0 100% 0 0)" });

      const t = gsap.timeline({
        scrollTrigger: { trigger: el, start: "top 90%" },
        delay: 0.5,
      });
      lines.forEach((line, i) => {
        const chars = lineChars(LINES[i]!);
        t.to(
          line,
          {
            clipPath: "inset(0 0% 0 0)",
            duration: Math.max(0.3, chars * 0.035),
            ease: `steps(${chars})`,
          },
          i === 0 ? 0 : ">+0.35",
        );
      });
      if (caret) {
        gsap.set(caret, { autoAlpha: 0 });
        t.set(caret, { autoAlpha: 1 }).to(caret, {
          autoAlpha: 0,
          duration: 0.55,
          repeat: -1,
          yoyo: true,
          ease: "steps(1)",
        });
      }
      tl.current = t;
    },
    { scope: root },
  );

  return (
    <div
      ref={root}
      onClick={() => tl.current?.restart()}
      title="Replay"
      className="glass-strong group cursor-pointer overflow-hidden rounded-2xl"
    >
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-pink/80" />
        <span className="h-3 w-3 rounded-full bg-cyan/70" />
        <span className="h-3 w-3 rounded-full bg-mint/70" />
        <span className="ml-2 font-mono text-xs text-faint">#task-128</span>
        <span className="ml-auto font-mono text-[10px] text-faint opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          ↻ replay
        </span>
      </div>

      {/* typed lines */}
      <div className="space-y-2.5 px-5 py-5 font-mono text-sm">
        {LINES.map((line, i) => (
          <div
            key={i}
            data-tline
            className="flex items-start gap-3 whitespace-nowrap"
          >
            {line.who && <span className="shrink-0 text-faint">{line.who}</span>}
            <span>
              {line.segs.map((s, j) => (
                <span key={j} className={s.c}>
                  {s.t}
                </span>
              ))}
            </span>
          </div>
        ))}
        <span
          data-caret
          aria-hidden
          className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-mint/80"
        />
      </div>
    </div>
  );
}
