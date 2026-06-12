import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import * as site from "@/lib/site";

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
    >
      <circle cx="12" cy="12" r="10" className="fill-mint/10 stroke-mint/40" strokeWidth="1.25" />
      <path
        d="M7.5 12.2l3 3 6-6.4"
        className="stroke-mint"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon({ className = "h-5 w-5 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="10" width="16" height="11" rx="3" className="fill-cyan/10 stroke-cyan/50" strokeWidth="1.25" />
      <path
        d="M8 10V7.5a4 4 0 1 1 8 0V10"
        className="stroke-cyan"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.6" className="fill-cyan" />
    </svg>
  );
}

export function Security() {
  return (
    <section id="security" className="relative py-20 sm:py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-mint/10 blur-[120px]"
      />
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal className="flex flex-col gap-8">
            <SectionHeading
              align="left"
              eyebrow="Security"
              title={
                <>
                  Locked down by{" "}
                  <span className="text-gradient">default</span>
                </>
              }
              subtitle="Repo content is untrusted, every task runs in an isolated, auto-removed container, and your bring-your-own LLM key is encrypted at rest. Defense in depth, not an afterthought."
            />
            <div>
              <Button variant="secondary" href="#faq">
                Read the FAQ →
              </Button>
            </div>

            <GlassCard ring className="relative mt-2 overflow-hidden p-7">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan/10 blur-3xl"
              />
              <div className="flex items-center gap-4">
                <LockIcon className="h-12 w-12" />
                <div>
                  <p className="font-display text-lg font-semibold text-fg">
                    Isolated by construction
                  </p>
                  <p className="text-sm text-muted">
                    Ephemeral, non-root, egress-locked.
                  </p>
                </div>
              </div>
              <div className="mt-6 space-y-2.5">
                {[
                  { label: "Linux capabilities", value: "ALL dropped" },
                  { label: "Filesystem", value: "ephemeral · auto-removed" },
                  { label: "Network (prod)", value: "Anthropic + GitHub only" },
                  { label: "Keys at rest", value: "AES-256-GCM · per-server" },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5 text-sm"
                  >
                    <span className="text-muted">{row.label}</span>
                    <span className="font-mono text-xs text-mint">{row.value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </Reveal>

          <Reveal stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {site.securityPoints.map((point, i) => (
              <GlassCard
                key={point.title}
                hover
                className="flex flex-col gap-2.5 p-5"
              >
                {i % 2 === 0 ? <CheckIcon /> : <LockIcon />}
                <h3 className="font-medium leading-snug text-fg">
                  {point.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted">
                  {point.body}
                </p>
              </GlassCard>
            ))}
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
