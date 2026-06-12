"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { cn } from "@/lib/cn";
import { steps, INSTALL_URL } from "@/lib/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Desktop: the section pins and the four steps ignite one by one as you
 * scroll, with the connecting line filling left → right — synced to the same
 * scroll that flies the 3D camera repo → PR behind it.
 * Mobile / reduced motion: simple staggered reveal, no pin.
 */
export function HowItWorks() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const stepEls = gsap.utils.toArray<HTMLElement>("[data-step]", el);
      const line = el.querySelector("[data-line]");

      const mm = gsap.matchMedia();

      // Pinned scrub — only desktop widths, only when motion is allowed.
      mm.add(
        "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
        () => {
          gsap.set(stepEls, { autoAlpha: 0.22, y: 40, scale: 0.96 });
          if (line) gsap.set(line, { scaleX: 0, transformOrigin: "left center" });

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: el,
              start: "top top+=72",
              end: "+=2000",
              pin: true,
              scrub: 0.6,
              anticipatePin: 1,
            },
          });

          stepEls.forEach((step, i) => {
            if (line) {
              tl.to(
                line,
                {
                  scaleX: (i + 1) / stepEls.length,
                  duration: 0.2,
                  ease: "none",
                },
                i * 0.26,
              );
            }
            tl.to(
              step,
              { autoAlpha: 1, y: 0, scale: 1, duration: 0.18, ease: "power2.out" },
              i * 0.26 + 0.03,
            );
          });
          // hold the finished state briefly before unpinning
          tl.to({}, { duration: 0.18 });
        },
      );

      // Mobile / tablet: plain stagger on enter.
      mm.add(
        "(max-width: 1023.5px) and (prefers-reduced-motion: no-preference)",
        () => {
          gsap.from(stepEls, {
            autoAlpha: 0,
            y: 28,
            stagger: 0.12,
            duration: 0.7,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 80%" },
          });
        },
      );
    },
    { scope: root },
  );

  return (
    <section ref={root} id="how" className="relative py-20 sm:py-28">
      {/* aurora glow accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-1/4 top-0 h-72 w-72 -translate-x-1/2 rounded-full bg-violet/10 blur-3xl animate-float" />
        <div className="absolute right-1/4 bottom-0 h-72 w-72 translate-x-1/2 rounded-full bg-cyan/10 blur-3xl animate-drift" />
      </div>

      <Container>
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              From a message to a{" "}
              <span className="text-gradient">merged PR</span>
            </>
          }
          subtitle="Four steps. No setup ceremony."
          align="center"
        />

        <div className="relative mt-16">
          {/* connecting gradient line: fills with scroll on lg, static vertical on mobile */}
          <div
            aria-hidden
            data-line
            className="pointer-events-none absolute left-7 top-7 bottom-7 w-px bg-gradient-to-b from-blurple/0 via-violet/50 to-cyan/0 lg:left-0 lg:right-0 lg:top-7 lg:bottom-auto lg:h-px lg:w-full lg:bg-gradient-to-r lg:from-blurple/60 lg:via-violet/60 lg:to-cyan/60"
          />

          <div className="grid grid-cols-1 gap-10 lg:grid-cols-4 lg:gap-6">
            {steps.map((step) => {
              const isInstall = step.n === "01";
              return (
                <div
                  key={step.n}
                  data-step
                  className="group relative flex gap-5 pl-2 lg:block lg:pl-0"
                >
                  {/* number badge — circular glass with gradient ring */}
                  <div className="relative z-10 shrink-0">
                    <div className="ring-aurora glass flex h-14 w-14 items-center justify-center rounded-full text-base font-mono font-semibold text-fg transition-transform duration-300 group-hover:-translate-y-0.5">
                      {step.n}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 lg:mt-7">
                    <span
                      aria-hidden
                      className="block font-mono text-5xl font-bold leading-none text-faint/60 lg:hidden"
                    >
                      {step.n}
                    </span>
                    <h3 className="mt-3 font-display text-xl font-semibold tracking-tight text-fg lg:mt-0">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {step.body}
                    </p>

                    {step.code ? (
                      isInstall ? (
                        <a
                          href={INSTALL_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ring-aurora mt-4 inline-flex items-center gap-1.5 rounded-full glass px-4 py-2 font-mono text-xs font-medium text-fg transition-all duration-300 hover:-translate-y-0.5 hover:text-blurple"
                        >
                          {step.code}
                        </a>
                      ) : (
                        <div className="glass mt-4 rounded-xl border border-line/60 p-3 font-mono text-xs leading-relaxed">
                          {step.code.split("\n").map((line, i) => (
                            <div
                              key={i}
                              className={cn(
                                "flex items-center gap-2",
                                line.startsWith("✓") ? "text-mint" : "text-cyan",
                              )}
                            >
                              <span aria-hidden className="select-none text-faint">
                                {line.startsWith("✓") ? "" : "›"}
                              </span>
                              <span className="truncate">{line}</span>
                            </div>
                          ))}
                        </div>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Container>
    </section>
  );
}
