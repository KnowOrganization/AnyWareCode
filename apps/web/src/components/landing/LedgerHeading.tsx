import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { DrawLine } from "./fx/DrawLine";
import { SplitRise } from "./fx/SplitRise";

/**
 * Standard chapter opener: mono folio line, hairline, oversized display
 * title (split-character rise), optional blurb. Every ledger section starts
 * with one.
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
    <div>
      <Reveal>
        <div className="label-mono flex items-baseline justify-between gap-4 text-faint">
          <span>
            <span className="text-primary">{n}</span> / {label}
          </span>
          <span aria-hidden className="hidden sm:inline">
            ANYWARECODE — LEDGER
          </span>
        </div>
        <DrawLine className="mt-4" />
      </Reveal>
      <h2 className="mt-8 font-display text-4xl font-bold uppercase leading-[0.98] tracking-tight sm:text-5xl lg:text-6xl">
        <SplitRise>{title}</SplitRise>
      </h2>
      {blurb ? (
        <Reveal delay={0.12}>
          <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">
            {blurb}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}
