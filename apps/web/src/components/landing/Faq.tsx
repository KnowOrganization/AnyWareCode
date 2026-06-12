import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { LedgerHeading } from "./LedgerHeading";
import * as site from "@/lib/site";

/**
 * Chapter 05 — FAQ as numbered queries on hairline rules. Native
 * details/summary: zero JS, fully keyboard-accessible.
 */
export function Faq() {
  return (
    <section id="faq" className="relative py-24 sm:py-32">
      <Container className="max-w-4xl">
        <LedgerHeading
          n="05"
          label="Queries"
          title={
            <>
              Asked &amp; <span className="text-outline">answered</span>
            </>
          }
        />

        <Reveal stagger className="mt-12">
          {site.faqs.map((f, i) => (
            <details key={f.q} className="group border-b border-line first:border-t">
              <summary className="flex cursor-pointer list-none items-baseline gap-4 py-6 [&::-webkit-details-marker]:hidden">
                <span className="label-mono shrink-0 text-faint transition-colors group-open:text-primary">
                  Q{String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 font-display text-base font-semibold tracking-tight sm:text-lg">
                  {f.q}
                </span>
                <span
                  aria-hidden
                  className="shrink-0 font-mono text-lg text-primary transition-transform duration-300 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="pb-7 pl-12 pr-8 text-[0.95rem] leading-relaxed text-muted group-open:animate-[fadeSlide_0.45s_ease_both]">
                {f.a}
              </p>
            </details>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
