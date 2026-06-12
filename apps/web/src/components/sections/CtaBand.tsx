import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/Reveal";
import { Magnetic } from "@/components/fx/Magnetic";
import * as site from "@/lib/site";

export function CtaBand() {
  return (
    <section id="cta" className="relative py-24">
      <Container>
        <Reveal>
          <div className="ring-aurora glass-strong relative overflow-hidden rounded-3xl px-8 py-16 text-center sm:py-20">
            {/* internal aurora glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-violet/20 blur-[120px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-cyan/20 blur-[120px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-[36rem] max-w-[90%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo/10 blur-[140px]"
            />

            <div className="relative mx-auto max-w-2xl">
              <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-fg sm:text-5xl">
                Give your server a{" "}
                <span className="text-gradient">coding agent.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
                Add AnywhereCode in a click. 14-day free trial, then bring your
                own key.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Magnetic>
                  <Button size="lg" variant="primary" href={site.INSTALL_URL}>
                    Add to Discord →
                  </Button>
                </Magnetic>
                <Magnetic strength={0.2}>
                  <Button size="lg" variant="secondary" href={site.DASHBOARD_URL}>
                    Open dashboard
                  </Button>
                </Magnetic>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
