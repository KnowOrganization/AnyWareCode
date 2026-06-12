import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/fx/Parallax";
import { Magnetic } from "@/components/fx/Magnetic";
import { TerminalDemo } from "@/components/fx/TerminalDemo";
import * as site from "@/lib/site";

export function Hero() {
  return (
    <section
      id="hero"
      className="relative flex min-h-[92vh] items-center pt-28 sm:pt-32"
    >
      <Container className="relative z-10">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          {/* Left: copy + CTAs — fastest parallax layer, fades on exit */}
          <Parallax speed={0.35} fade className="max-w-2xl">
            <Reveal stagger>
              <div className="mb-6">
                <Badge>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
                  </span>
                  Your server&apos;s coding agent
                </Badge>
              </div>

              <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
                Ship code from your
                <br />
                <span className="text-gradient">Discord server.</span>
              </h1>

              <p className="mt-6 max-w-xl text-lg text-muted">
                AnywhereCode runs a shared coding agent on your GitHub repos and
                opens pull requests — type{" "}
                <code className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[0.9em] text-cyan">
                  /code
                </code>{" "}
                in any channel and review the PR.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Magnetic>
                  <Button size="lg" variant="primary" href={site.INSTALL_URL}>
                    Add to Discord →
                  </Button>
                </Magnetic>
                <Magnetic strength={0.2}>
                  <Button size="lg" variant="secondary" href="#how">
                    See how it works
                  </Button>
                </Magnetic>
              </div>

              <p className="mt-7 text-sm text-faint">
                BYO LLM key{" "}
                <span aria-hidden className="px-1.5 text-line-strong">
                  ·
                </span>{" "}
                Isolated containers{" "}
                <span aria-hidden className="px-1.5 text-line-strong">
                  ·
                </span>{" "}
                Never pushes to main
              </p>
            </Reveal>
          </Parallax>

          {/* Right: typewriter terminal — slower layer, reads as depth */}
          <Parallax speed={0.15} className="w-full">
            <Reveal delay={0.15} y={36}>
              <div className="ring-aurora animate-float relative rounded-2xl">
                <TerminalDemo />
              </div>
            </Reveal>
          </Parallax>
        </div>

        {/* scroll cue */}
        <div className="pointer-events-none absolute inset-x-0 -bottom-2 hidden justify-center sm:flex">
          <div className="flex h-9 w-6 items-start justify-center rounded-full border border-line-strong p-1.5">
            <div className="h-2 w-1 animate-[float_1.6s_ease-in-out_infinite] rounded-full bg-muted" />
          </div>
        </div>
      </Container>
    </section>
  );
}
