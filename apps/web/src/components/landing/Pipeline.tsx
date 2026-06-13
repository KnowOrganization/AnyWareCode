"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Container } from "@/components/ui/Container";
import { Custody } from "./Custody";
import { webglOk } from "@/lib/webgl";
import * as site from "@/lib/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const PipelineScene = dynamic(() => import("@/components/three/PipelineScene"), {
  ssr: false,
});

/** Scene-time boundaries for each HUD stage (must match PipelineScene). */
const STAGE_AT = [0, 0.3, 0.48, 0.7] as const;

/**
 * Chapter 02, cinematic edition — a 420vh scroll-pinned 3D shot of one task's
 * chain of custody, with a HUD narrating each stage. Desktops with WebGL and
 * motion get the scene; everyone else gets the flat Custody chapter (also the
 * SSR markup, so crawlers read real copy).
 */
export function Pipeline() {
  const [mode, setMode] = useState<"flat" | "3d">("flat");
  const [active, setActive] = useState(false);
  const [stage, setStage] = useState(0);
  const outer = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const chip0Ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () =>
      setMode(wide.matches && !motion.matches && webglOk() ? "3d" : "flat");
    decide();
    wide.addEventListener("change", decide);
    motion.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      motion.removeEventListener("change", decide);
    };
  }, []);

  // the rest of the page repositions when the 420vh section appears
  useEffect(() => {
    ScrollTrigger.refresh();
  }, [mode]);

  useEffect(() => {
    if (mode !== "3d") return;
    const el = outer.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setActive(e?.isIntersecting ?? false),
      { rootMargin: "40%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mode]);

  useGSAP(
    () => {
      if (mode !== "3d" || !outer.current) return;
      ScrollTrigger.create({
        trigger: outer.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          const p = self.progress;
          progress.current = p;
          let s = 0;
          for (let i = 0; i < STAGE_AT.length; i++) if (p >= STAGE_AT[i]!) s = i;
          setStage(s);
          if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
          if (pctRef.current)
            pctRef.current.textContent = `T+${p.toFixed(2)}`;
          if (hintRef.current)
            hintRef.current.style.opacity = p < 0.08 ? "1" : "0";
          // stage 1: the command types itself as the user scrolls
          if (chip0Ref.current) {
            const full = site.pipeline[0]!.chip;
            const local = Math.min(1, p / STAGE_AT[1]!);
            const n = Math.min(full.length, Math.round(local * 1.6 * full.length));
            chip0Ref.current.textContent = full.slice(0, n);
          }
        },
      });
    },
    { scope: outer, dependencies: [mode] },
  );

  if (mode === "flat") return <Custody />;

  return (
    <section ref={outer} id="how" className="relative h-[420vh]">
      <div data-cursor className="sticky top-0 h-screen overflow-hidden">
        {/* scene */}
        <div className="absolute inset-0">
          <PipelineScene progress={progress} active={active} />
        </div>
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(58% 48% at 50% 44%, rgba(0,245,212,0.06), transparent 72%)",
          }}
        />

        {/* HUD */}
        <Container className="pointer-events-none relative z-10 flex h-full flex-col justify-between py-10">
          <div>
            <div className="label-mono flex items-center justify-between border-b border-line pb-4 text-faint">
              <span>
                <span className="text-primary">02</span> / CUSTODY —{" "}
                <span className="text-fg/80">LIVE TELEMETRY</span>
              </span>
              <span className="hidden sm:inline">ONE TASK, START TO MERGE</span>
            </div>
            <h2 className="mt-6 font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">
              Chain of <span className="text-outline">custody</span>
            </h2>
          </div>

          <div className="flex items-end justify-between gap-10">
            {/* stage cards */}
            <div className="relative h-56 w-full max-w-md">
              {site.pipeline.map((s, i) => (
                <div
                  key={s.n}
                  className={`absolute bottom-0 left-0 w-full transition-all duration-500 ease-out ${
                    i === stage
                      ? "translate-y-0 opacity-100"
                      : "translate-y-5 opacity-0"
                  }`}
                >
                  <p className="font-display text-6xl font-bold leading-none text-outline-teal">
                    {s.n}
                  </p>
                  <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">
                    {s.title}
                    {i === site.pipeline.length - 1 && (
                      <span className="stamp ml-3 -rotate-3 px-2 py-1 text-[0.55rem] align-middle">
                        Merge
                      </span>
                    )}
                  </h3>
                  <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                    {s.body}
                  </p>
                  <p className="mt-3 inline-block rounded-[0.3rem] border border-line bg-bg-soft/80 px-3 py-1.5 font-mono text-[0.72rem] text-primary/90">
                    {i === 0 ? (
                      <>
                        <span ref={chip0Ref}>{s.chip}</span>
                        <span
                          aria-hidden
                          className="animate-[caretBlink_1.1s_steps(2)_infinite]"
                        >
                          ▍
                        </span>
                      </>
                    ) : (
                      s.chip
                    )}
                  </p>
                </div>
              ))}
            </div>

            {/* telemetry rail */}
            <div className="hidden w-44 shrink-0 sm:block">
              <p
                ref={hintRef}
                className="label-mono mb-4 text-faint transition-opacity duration-500"
              >
                Scroll to advance ↓
                <br />
                <span className="text-primary/70">Click — the field answers</span>
              </p>
              <div className="label-mono flex items-center justify-between text-faint">
                <span ref={pctRef} className="text-primary tabular-nums">
                  T+0.00
                </span>
                <span>/ 1.00</span>
              </div>
              <div className="mt-2 h-px w-full bg-line">
                <div
                  ref={barRef}
                  className="h-px origin-left scale-x-0 bg-primary"
                />
              </div>
              <div className="mt-4 space-y-1.5">
                {site.pipeline.map((s, i) => (
                  <p
                    key={s.n}
                    className={`label-mono transition-colors duration-300 ${
                      i === stage ? "text-primary" : "text-faint"
                    }`}
                  >
                    {s.n} {s.title}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
