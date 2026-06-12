"use client";

import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";
import * as site from "@/lib/site";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn(
        "h-5 w-5 shrink-0 text-muted transition-transform duration-300",
        open && "rotate-180 text-violet",
      )}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Faq() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section id="faq" className="relative py-20 sm:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/4 -z-10 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-violet/10 blur-[120px]"
      />
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="FAQ"
            title={
              <>
                Questions, <span className="text-gradient">answered</span>
              </>
            }
          />
        </Reveal>

        <Reveal className="mx-auto mt-12 max-w-3xl" y={24}>
          <GlassCard ring className="divide-y divide-line p-2 sm:p-3">
            {site.faqs.map((faq, i) => {
              const open = openIndex === i;
              const panelId = `faq-panel-${i}`;
              const buttonId = `faq-button-${i}`;
              return (
                <div key={faq.q} className="px-2 sm:px-3">
                  <h3>
                    <button
                      type="button"
                      id={buttonId}
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setOpenIndex(open ? -1 : i)}
                      className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-5 text-left transition-colors hover:text-fg"
                    >
                      <span
                        className={cn(
                          "font-medium leading-snug transition-colors",
                          open ? "text-fg" : "text-fg/90",
                        )}
                      >
                        {faq.q}
                      </span>
                      <Chevron open={open} />
                    </button>
                  </h3>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className={cn(
                      "grid transition-all duration-300 ease-out",
                      open
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="px-3 pb-5 text-sm leading-relaxed text-muted sm:text-base">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </GlassCard>
        </Reveal>
      </Container>
    </section>
  );
}
