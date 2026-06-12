import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { BatchReveal } from "./fx/BatchReveal";
import { LedgerHeading } from "./LedgerHeading";
import * as site from "@/lib/site";

/**
 * Chapter 01 — features as ledger entries: numbered hairline rows instead of
 * cards. Hover grows a teal spine from the left rule.
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
          blurb="Every capability is an entry in the server's ledger — invoked in public channels, executed in isolation, accounted for in the receipt."
        />

        <BatchReveal className="mt-14">
          {site.features.map((f, i) => (
            <article
              key={f.title}
              className="entry-spine group relative grid gap-2 border-b border-line py-7 pl-6 pr-2 transition-colors duration-300 first:border-t hover:bg-surface sm:grid-cols-[4.5rem_minmax(0,0.9fr)_minmax(0,1.4fr)] sm:gap-6 sm:py-8"
            >
              <span className="label-mono text-faint transition-colors group-hover:text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                <span aria-hidden className="mr-3 inline-block text-primary/80">
                  {f.icon}
                </span>
                {f.title}
              </h3>
              <p className="text-[0.95rem] leading-relaxed text-muted">
                {f.body}
              </p>
            </article>
          ))}
        </BatchReveal>

        <Reveal>
          <p className="label-mono mt-6 text-right text-faint">
            10 ENTRIES — NOTHING OFF THE BOOKS
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
