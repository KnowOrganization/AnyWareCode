import { Container } from "@/components/ui/Container";
import { CustodyFx } from "./fx/CustodyFx";
import { LedgerHeading } from "./LedgerHeading";
import * as site from "@/lib/site";

/**
 * Chapter 02 — how it works as a chain of custody: four stations on one rule,
 * the last one stamped (the merge endpoint, amber by token law).
 */
export function Custody() {
  const last = site.steps.length - 1;
  return (
    <section id="how" className="relative py-24 sm:py-32">
      <Container>
        <LedgerHeading
          n="02"
          label="Custody"
          title={
            <>
              Chain of <span className="text-outline">custody</span>
            </>
          }
          blurb="From prompt to pull request in four hand-offs — each one visible in the thread, none of them touching your default branch."
        />

        <CustodyFx className="relative mt-16 grid gap-10 lg:grid-cols-4 lg:gap-0">
          {site.steps.map((s, i) => (
            <div key={s.n} className="relative pl-8 lg:px-6 lg:pt-10">
              {/* connector: vertical on mobile, horizontal on lg */}
              <span
                aria-hidden
                className="absolute left-[5px] top-2 h-full w-px bg-line lg:left-0 lg:top-0 lg:h-px lg:w-full"
              />
              {/* teal fill drawn over the rule as the chapter scrolls */}
              <span
                data-fill
                aria-hidden
                className="absolute left-[5px] top-2 h-full w-px scale-0 bg-primary/60 lg:left-0 lg:top-0 lg:h-px lg:w-full"
              />
              <span
                data-dot
                aria-hidden
                className={`absolute left-0 top-1 size-[11px] rounded-full border-2 lg:-top-[5px] lg:left-6 ${
                  i === last
                    ? "border-amber bg-amber/20"
                    : "border-primary bg-bg"
                }`}
              />
              <p className="font-display text-5xl font-bold leading-none text-outline">
                {s.n}
              </p>
              <h3 className="mt-4 font-display text-lg font-semibold tracking-tight">
                {s.title}
                {i === last && (
                  <span className="stamp ml-3 -rotate-3 px-2 py-1 text-[0.55rem] align-middle">
                    Merge
                  </span>
                )}
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">
                {s.body}
              </p>
              {s.code ? (
                <pre className="mt-4 overflow-x-auto whitespace-pre-line rounded-[0.3rem] border border-line bg-bg-soft px-3.5 py-2.5 font-mono text-[0.74rem] leading-relaxed text-primary/90">
                  {s.code}
                </pre>
              ) : null}
            </div>
          ))}
        </CustodyFx>
      </Container>
    </section>
  );
}
