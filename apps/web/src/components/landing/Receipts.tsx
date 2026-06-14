import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { Cta } from "./Cta";
import { LedgerHeading } from "./LedgerHeading";
import * as site from "@/lib/site";
import { cn } from "@/lib/cn";

/**
 * Chapter 04 — pricing as literal receipts: perforated paper, mono line
 * items, dashed rules. Pro carries the amber RECOMMENDED stamp; the Task
 * Pack is a torn stub below the till.
 */
export function Receipts() {
  return (
    <section id="pricing" className="relative py-24 sm:py-32">
      <Container>
        <LedgerHeading
          n="04"
          label="Receipts"
          title={
            <>
              Per server, <span className="text-outline">not per seat</span>
            </>
          }
          blurb="One subscription, the whole server — no per-seat math. Every plan ships every feature; the only meter is monthly /code. You bring your own AI — we never bill for it."
        />

        <Reveal stagger className="mt-14 grid items-start gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {site.tiers.map((t) => (
            <div key={t.id} className="relative">
              <div
                className={cn(
                  "perf-y bg-bg-soft px-7 pb-9 pt-8",
                  t.featured &&
                    "shadow-[0_0_0_1px_rgba(0,245,212,0.35),0_30px_80px_-30px_rgba(0,245,212,0.25)]",
                )}
              >
                <p className="label-mono text-faint">
                  PLAN /{" "}
                  <span className={t.featured ? "text-primary" : "text-fg/80"}>
                    {t.name}
                  </span>
                </p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-5xl font-bold tracking-tight">
                    {t.price}
                  </span>
                  <span className="font-mono text-sm text-faint">{t.period}</span>
                </div>
                <p className="mt-3 min-h-10 text-sm text-muted">{t.tagline}</p>

                <div className="rule-dash mt-6" />
                <ul className="mt-5 space-y-3">
                  {t.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-baseline gap-3 font-mono text-[0.78rem] leading-relaxed text-fg/85"
                    >
                      <span className="text-primary" aria-hidden>
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="rule-dash mt-6" />

                <Cta
                  href={site.INSTALL_URL}
                  variant={t.featured ? "solid" : "outline"}
                  className="mt-7 w-full"
                >
                  {t.cta}
                </Cta>
                <p
                  aria-hidden
                  className="label-mono mt-5 text-center text-faint"
                >
                  ··· thank you for shipping ···
                </p>
              </div>

              {t.featured && (
                <span className="stamp absolute -top-3 right-5 rotate-6">
                  Recommended
                </span>
              )}
            </div>
          ))}
        </Reveal>

        {/* Task pack — the torn stub */}
        <Reveal>
          <div className="perf-y mt-10 grid gap-6 bg-bg-soft px-7 py-7 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="label-mono text-faint">
                STUB / <span className="text-amber">{site.taskPack.name}</span>{" "}
                — {site.taskPack.price}
              </p>
              <p className="mt-2.5 max-w-2xl text-sm text-muted">
                {site.taskPack.blurb}
              </p>
            </div>
            <Cta href={site.INSTALL_URL} variant="outline">
              Buy in Discord
            </Cta>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
