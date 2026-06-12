import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { Magnetic } from "@/components/fx/Magnetic";
import { MaskRise } from "./fx/MaskRise";
import { Parallax } from "./fx/Parallax";
import { Cta } from "./Cta";
import { ReceiptCard } from "./ReceiptCard";
import * as site from "@/lib/site";

/**
 * Chapter 00 — the manifest cover. Oversized declaration on the left, the
 * provenance receipt artifact on the right.
 */
export function Hero() {
  return (
    <section id="hero" className="relative pt-16">
      <Container>
        {/* Folio line */}
        <Reveal y={12}>
          <div className="label-mono flex items-center justify-between gap-4 border-b border-line py-4 text-faint">
            <span>
              LEDGER Nº 001 — <span className="text-fg/80">SHIPPING MANIFEST</span>
            </span>
            <span className="hidden sm:inline">DISCORD-NATIVE · EST. 2026</span>
          </div>
        </Reveal>

        <div className="grid items-end gap-12 pb-20 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16 lg:pb-28">
          <Parallax speed={0.3}>
            <MaskRise>
              <h1 className="font-display text-[clamp(2.9rem,9.5vw,6.8rem)] font-bold uppercase leading-[0.92] tracking-tight">
                <span className="block overflow-hidden">
                  <span data-line className="block">
                    Ship code
                  </span>
                </span>
                <span className="block overflow-hidden">
                  <span data-line className="block">
                    from <span className="text-outline">Discord.</span>
                  </span>
                </span>
                <span className="block overflow-hidden">
                  <span data-line className="block text-primary">
                    Signed<span className="text-amber">*</span>
                  </span>
                </span>
              </h1>
            </MaskRise>

            <Reveal stagger delay={0.35}>
              <p className="mt-7 max-w-xl text-base text-muted sm:text-lg">
                One shared AI engineer for your whole server. Type{" "}
                <code className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[0.9em] text-primary">
                  /code
                </code>{" "}
                in any channel — it works the task in an isolated container,
                opens a pull request, and waits for a human to merge.
              </p>

              <p className="label-mono mt-4 max-w-xl text-faint">
                <span className="text-amber">*</span> every PR carries a named
                human sponsor and a provenance receipt.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Magnetic>
                  <Cta href={site.INSTALL_URL}>Add to Discord →</Cta>
                </Magnetic>
                <Cta href="#features" variant="outline">
                  Read the manifest ↓
                </Cta>
              </div>

              <p className="label-mono mt-8 text-faint">
                BYO LLM key <span className="px-1 text-line-strong">·</span>{" "}
                isolated containers{" "}
                <span className="px-1 text-line-strong">·</span> never pushes to
                main
              </p>
            </Reveal>
          </Parallax>

          <Parallax speed={0.12} className="lg:pb-2">
            <Reveal delay={0.2} y={36}>
              <ReceiptCard />
            </Reveal>
          </Parallax>
        </div>
      </Container>
    </section>
  );
}
