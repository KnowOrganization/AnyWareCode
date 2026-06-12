import * as site from "@/lib/site";

/**
 * Full-bleed command ticker between chapters — the slash-command surface as a
 * stock tape. Content duplicated once for the seamless -50% marquee loop.
 */
export function Ticker() {
  const reel = (ariaHidden: boolean) => (
    <div
      aria-hidden={ariaHidden || undefined}
      className="flex shrink-0 items-center"
    >
      {site.commands.map(({ cmd, desc }) => (
        <span
          key={cmd}
          className="label-mono flex items-center whitespace-nowrap text-faint"
        >
          <span className="px-5 text-amber/70" aria-hidden>
            ✦
          </span>
          <span className="text-primary">{cmd}</span>
          <span className="pl-3 normal-case tracking-normal">{desc}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="ticker-mask overflow-hidden border-y border-line py-4">
      <div className="flex w-max animate-marquee">
        {reel(false)}
        {reel(true)}
      </div>
    </div>
  );
}
