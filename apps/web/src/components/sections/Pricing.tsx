import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";
import { taskPack, tiers, INSTALL_URL, DASHBOARD_URL, type Tier } from "@/lib/site";

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 flex-none text-mint"
    >
      <path
        d="m5 10.5 3.2 3.2L15 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const featured = tier.featured === true;
  const href = tier.external ? INSTALL_URL : DASHBOARD_URL;

  const body = (
    <div className="flex h-full flex-col p-7 sm:p-8">
      {featured && (
        <div className="absolute right-5 top-5">
          <Badge className="border-violet/40 bg-violet/10 text-fg">
            Most popular
          </Badge>
        </div>
      )}

      <h3 className="font-display text-xl font-semibold text-fg">{tier.name}</h3>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-display text-5xl font-semibold tracking-tight text-fg">
          {tier.price}
        </span>
        <span className="text-muted">{tier.period}</span>
      </div>

      <p className="mt-3 text-sm text-muted">{tier.tagline}</p>

      <div className="my-6 h-px w-full bg-line" />

      <ul className="flex flex-col gap-3">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm text-fg/90">
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        <Button
          href={href}
          variant={featured ? "primary" : "secondary"}
          size="md"
          className="w-full justify-center"
        >
          {tier.cta} →
        </Button>
      </div>
    </div>
  );

  if (featured) {
    return (
      <div className="glass-strong ring-aurora relative flex flex-col overflow-hidden rounded-3xl md:scale-[1.03]">
        {body}
      </div>
    );
  }

  return (
    <GlassCard hover className="flex flex-col">
      {body}
    </GlassCard>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="relative py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Pricing"
          title={
            <>
              Simple, <span className="text-gradient">per-server</span> pricing
            </>
          }
          subtitle="One subscription for the whole server — no per-seat licenses. 14-day trial, then bring your own LLM key."
        />

        <Reveal
          stagger
          className={cn(
            "mt-14 grid grid-cols-1 items-stretch gap-6",
            "md:mt-16 md:grid-cols-3",
          )}
        >
          {tiers.map((tier) => (
            <TierCard key={tier.id} tier={tier} />
          ))}
        </Reveal>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">
          🔋 <strong className="text-fg">{taskPack.name} — {taskPack.price}</strong>
          : {taskPack.blurb}
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-faint">
          Paid plans check out per server from your dashboard after you sign in
          with Discord. Caps reset monthly.
        </p>
      </Container>
    </section>
  );
}
