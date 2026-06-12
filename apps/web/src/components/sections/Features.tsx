import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { TiltCard } from "@/components/fx/TiltCard";
import { features, type Feature } from "@/lib/site";

type Accent = Feature["accent"];

/** Icon glyph color per accent. */
const ICON_TEXT: Record<Accent, string> = {
  indigo: "text-indigo",
  violet: "text-violet",
  cyan: "text-cyan",
  pink: "text-pink",
  mint: "text-mint",
  blurple: "text-blurple",
};

/** Soft accent tint + ring behind the icon tile. */
const ICON_TILE: Record<Accent, string> = {
  indigo: "bg-indigo/10 ring-indigo/20",
  violet: "bg-violet/10 ring-violet/20",
  cyan: "bg-cyan/10 ring-cyan/20",
  pink: "bg-pink/10 ring-pink/20",
  mint: "bg-mint/10 ring-mint/20",
  blurple: "bg-blurple/10 ring-blurple/20",
};

/** Hover glow blob color per accent. */
const GLOW: Record<Accent, string> = {
  indigo: "bg-indigo/20",
  violet: "bg-violet/20",
  cyan: "bg-cyan/20",
  pink: "bg-pink/20",
  mint: "bg-mint/20",
  blurple: "bg-blurple/20",
};

export function Features() {
  return (
    <section id="features" className="relative py-20 sm:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Capabilities"
            title={
              <>
                Everything your server needs to{" "}
                <span className="text-gradient">ship</span>
              </>
            }
            subtitle="A shared coding agent that lives in Discord — from a one-line task to a reviewed pull request, with the guardrails baked in."
          />
        </Reveal>

        <Reveal
          stagger
          className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => (
            <TiltCard key={f.title} className="h-full rounded-[1.25rem]">
              <GlassCard
                hover
                className="group p-6 sm:p-7 h-full flex flex-col gap-3"
              >
              {/* hover accent glow */}
              <div
                aria-hidden
                className={`pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full ${GLOW[f.accent]} opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100`}
              />

              <div
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl ring-1 ${ICON_TILE[f.accent]} shadow-lg shadow-black/20`}
              >
                <span
                  className={`font-display text-xl leading-none ${ICON_TEXT[f.accent]} drop-shadow`}
                  aria-hidden
                >
                  {f.icon}
                </span>
              </div>

              <h3 className="relative font-display text-lg font-semibold tracking-tight text-fg">
                {f.title}
              </h3>
              <p className="relative text-sm leading-relaxed text-muted">
                {f.body}
              </p>
              </GlassCard>
            </TiltCard>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
