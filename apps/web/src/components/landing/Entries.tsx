import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { BatchReveal } from "./fx/BatchReveal";
import { LedgerHeading } from "./LedgerHeading";
import * as site from "@/lib/site";

/**
 * Chapter 01 — four verb-led entries carry the story; hovering a row unfolds
 * its detail (always unfolded on touch). The remaining capabilities sit in a
 * compact annex index so the chapter stays one readable beat.
 */
export function Entries() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <Container>
        <LedgerHeading
          n="01"
          label="Entries"
          title={
            <>
              What gets <span className="text-outline">logged</span>
            </>
          }
          blurb="Four entries carry the story. The annexes carry the rest."
        />

        <BatchReveal className="mt-14">
          {site.leadEntries.map((e, i) => (
            <article
              key={e.verb}
              tabIndex={0}
              className="entry-spine group relative border-b border-line py-7 pl-6 pr-2 transition-colors duration-300 first:border-t hover:bg-surface focus-visible:bg-surface focus-visible:outline-none sm:py-9"
            >
              <div className="grid items-baseline gap-x-8 gap-y-1 sm:grid-cols-[5rem_minmax(0,1fr)_auto]">
                <span className="label-mono text-faint transition-colors duration-300 group-hover:text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {e.verb}
                  <span className="ml-4 font-mono text-sm font-normal tracking-normal text-muted">
                    {e.line}
                  </span>
                </h3>
                <span
                  aria-hidden
                  className="hidden font-mono text-lg text-faint transition-all duration-300 group-hover:translate-x-1 group-hover:text-primary sm:inline"
                >
                  →
                </span>
              </div>
              {/* unfolds on hover/focus on fine pointers; open by default on touch */}
              <div className="grid grid-rows-[1fr] transition-[grid-template-rows] duration-500 ease-out lg:grid-rows-[0fr] lg:group-hover:grid-rows-[1fr] lg:group-focus-visible:grid-rows-[1fr]">
                <div className="overflow-hidden">
                  <p className="max-w-2xl pt-3 text-[0.95rem] leading-relaxed text-muted sm:pl-[7rem] lg:pt-4">
                    {e.body}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </BatchReveal>

        {/* annex index — everything else, one line each */}
        <Reveal className="mt-14">
          <p className="label-mono text-faint">
            ANNEX — <span className="text-fg/80">ALSO IN THE LEDGER</span>
          </p>
          <div className="mt-4 grid gap-x-12 sm:grid-cols-2">
            {site.annexes.map((a) => (
              <div
                key={a.title}
                className="flex items-baseline gap-3 border-b border-line py-3.5"
              >
                <span aria-hidden className="font-mono text-primary">
                  +
                </span>
                <p className="font-mono text-[0.78rem] leading-relaxed">
                  <span className="text-fg/90">{a.title}</span>
                  <span className="text-faint"> — {a.line}</span>
                </p>
              </div>
            ))}
          </div>
          <p className="label-mono mt-6 text-right text-faint">
            04 ENTRIES · 06 ANNEXES — NOTHING OFF THE BOOKS
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
