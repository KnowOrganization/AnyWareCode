import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";

/**
 * Standard chapter opener: mono folio line, hairline, oversized display
 * title, optional blurb. Every ledger section starts with one.
 */
export function LedgerHeading({
  n,
  label,
  title,
  blurb,
}: {
  n: string;
  label: string;
  title: ReactNode;
  blurb?: ReactNode;
}) {
  return (
    <Reveal>
      <div className="label-mono flex items-baseline justify-between gap-4 text-faint">
        <span>
          <span className="text-primary">{n}</span> / {label}
        </span>
        <span aria-hidden className="hidden sm:inline">
          ANYWARECODE — LEDGER
        </span>
      </div>
      <div className="mt-4 h-px bg-line" />
      <h2 className="mt-8 font-display text-4xl font-bold uppercase leading-[0.98] tracking-tight sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      {blurb ? (
        <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">{blurb}</p>
      ) : null}
    </Reveal>
  );
}
