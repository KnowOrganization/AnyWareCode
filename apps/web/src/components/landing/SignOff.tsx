import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { Magnetic } from "@/components/fx/Magnetic";
import { DrawLine } from "./fx/DrawLine";
import { MaskRise } from "./fx/MaskRise";
import { Cta } from "./Cta";
import * as site from "@/lib/site";

/**
 * Chapter 06 — the sign-off page. Three-line verdict, signature rule, CTAs.
 */
export function SignOff() {
  return (
    <section
      id="signoff"
      className="bg-grid relative border-t border-line py-28 sm:py-36"
    >
      <Container className="text-center">
        <Reveal y={12}>
          <p className="label-mono text-faint">06 / SIGN-OFF</p>
        </Reveal>
        <MaskRise>
          <h2 className="mt-6 font-display text-[clamp(2.8rem,9vw,6.5rem)] font-bold uppercase leading-[0.92] tracking-tight">
            <span className="block overflow-hidden">
              <span data-line className="block">
                Signed.
              </span>
            </span>
            <span className="block overflow-hidden">
              <span data-line className="block text-outline">
                Sealed.
              </span>
            </span>
            <span className="block overflow-hidden">
              <span data-line className="block text-primary">
                Shipped.
              </span>
            </span>
          </h2>
        </MaskRise>
        <Reveal stagger delay={0.25}>
          <p className="mx-auto mt-7 max-w-xl text-base text-muted sm:text-lg">
            Install the bot, connect a repo, type{" "}
            <code className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[0.9em] text-primary">
              /code
            </code>
            . Free to start — your key, your rules, every feature included.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Magnetic>
              <Cta href={site.INSTALL_URL} className="h-14 px-9">
                Add to Discord →
              </Cta>
            </Magnetic>
            <Cta href={site.DASHBOARD_URL} variant="outline" className="h-14 px-9">
              Open dashboard
            </Cta>
          </div>
          <div className="mx-auto mt-14 max-w-sm">
            <DrawLine />
            <p className="label-mono mt-3 text-faint">
              AUTHORIZED SIGNATURE — YOUR SERVER
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
