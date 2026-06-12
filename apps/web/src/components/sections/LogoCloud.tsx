import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { VelocityMarquee } from "@/components/fx/VelocityMarquee";
import { cn } from "@/lib/cn";
import { commands } from "@/lib/site";

interface Integration {
  name: string;
  glyph: string;
  /** Hover color for the glyph + name. */
  hover: string;
}

const integrations: Integration[] = [
  { name: "GitHub", glyph: "", hover: "group-hover:text-fg" },
  { name: "Discord", glyph: "", hover: "group-hover:text-blurple" },
  { name: "Claude", glyph: "", hover: "group-hover:text-violet" },
];

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.73.5 12.02c0 5.1 3.29 9.42 7.86 10.95.58.1.79-.25.79-.56v-2.1c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.52 11.52 0 0 0 23.5 12.02C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="currentColor">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3a.07.07 0 0 0-.08.04c-.21.37-.44.86-.6 1.24a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.24A.07.07 0 0 0 8.58 3 19.74 19.74 0 0 0 3.7 4.37a.06.06 0 0 0-.03.02C.57 9.04-.28 13.58.14 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 5.99 3.04.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12l.37-.29a.07.07 0 0 1 .08-.01 14.2 14.2 0 0 0 12.06 0 .07.07 0 0 1 .08 0l.37.3a.08.08 0 0 1-.01.12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.78 1.36 1.22 2a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.04.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.54-13.67a.06.06 0 0 0-.03-.02ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

function ClaudeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="currentColor">
      <path d="M4.7 16.3 9.3 13.7l.08-.22-.08-.13H9.1l-.74-.05-2.52-.07-2.18-.09-2.12-.11-.53-.11L0 12.16l.05-.32.45-.3.64.06 1.41.1 2.12.14 1.54.09 2.28.24h.36l.05-.15-.12-.09-.1-.09-2.18-1.48-2.36-1.56-1.24-.9-.67-.46-.34-.43-.14-.94.6-.66.8.05.21.06.82.63 1.74 1.35 2.28 1.68.33.28.13-.1.02-.06-.15-.25-1.22-2.2-1.3-2.24-.58-.93-.15-.56a2.7 2.7 0 0 1-.1-.66l.7-.94L8 2l.93.13.39.34.58 1.32.94 2.08 1.45 2.84.43.84.23.77.08.24h.15v-.14l.12-1.62.22-1.99.21-2.56.08-.72.34-.83.68-.45.53.26.44.62-.06.4-.26 1.7-.52 2.68-.34 1.8h.2l.22-.23.92-1.22 1.54-1.92.68-.76.79-.84.5-.4h.97l.7 1.06-.32 1.1-1 1.26-.83 1.07-1.18 1.6-.74 1.27.07.1.18-.02 2.7-.57 1.46-.27 1.74-.3.79.37.08.38-.31.76-1.88.46-2.2.44-3.28.78-.04.03.05.06 1.48.14.63.03h1.55l2.88.22.75.5.45.6-.08.46-1.16.6-1.55-.37-3.62-.86-1.24-.31h-.17v.1l1.04 1 1.9 1.71 2.37 2.2.12.55-.3.43-.32-.04-2.08-1.56-.8-.71-1.82-1.53h-.12v.16l.42.61 2.21 3.33.12 1.02-.16.33-.57.2-.63-.11-1.28-1.81-1.33-2.03-1.07-1.83-.13.08-.63 6.79-.3.35-.68.26-.56-.43-.3-.7.3-1.36.36-1.77.3-1.4.26-1.75.16-.58-.01-.04-.13.01-1.32 1.82-2.01 2.72-1.6 1.7-.38.15-.66-.34.06-.61.37-.54 2.2-2.8 1.33-1.73.86-1-.01-.15h-.05L4.18 18.4l-1.16.15-.5-.47.06-.77.24-.25 2-1.37Z" />
    </svg>
  );
}

const glyphMap: Record<string, () => React.ReactElement> = {
  GitHub: GitHubGlyph,
  Discord: DiscordGlyph,
  Claude: ClaudeGlyph,
};

export function LogoCloud() {
  return (
    <section id="logos" className="relative py-20 sm:py-28">
      <Container>
        <Reveal className="flex flex-col items-center gap-8">
          <p className="text-center text-sm font-medium uppercase tracking-[0.2em] text-muted">
            Plugs into the tools you already use
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {integrations.map((it) => {
              const Glyph = glyphMap[it.name];
              return (
                <div
                  key={it.name}
                  className="glass group inline-flex items-center gap-2.5 rounded-full px-5 py-2.5 text-faint transition-colors duration-300 hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "inline-flex transition-colors duration-300",
                      it.hover,
                    )}
                  >
                    {Glyph ? <Glyph /> : it.glyph}
                  </span>
                  <span
                    className={cn(
                      "font-medium text-muted transition-colors duration-300 group-hover:text-fg",
                    )}
                  >
                    {it.name}
                  </span>
                </div>
              );
            })}
          </div>
        </Reveal>
      </Container>

      {/* Edge-masked, full-bleed command marquee — reacts to scroll velocity. */}
      <div
        className="pointer-events-none relative mt-12 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
        }}
        aria-hidden
      >
        <VelocityMarquee>
          {commands.map((c) => (
            <div
              key={c.cmd}
              className="glass mr-4 inline-flex shrink-0 items-center gap-2.5 rounded-full px-4 py-2"
            >
              <code className="font-mono text-sm text-fg">{c.cmd}</code>
              <span className="font-mono text-xs text-faint">{c.desc}</span>
            </div>
          ))}
        </VelocityMarquee>
      </div>
    </section>
  );
}
