import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/Reveal";
import { BatchReveal } from "./fx/BatchReveal";
import { LedgerHeading } from "./LedgerHeading";
import * as site from "@/lib/site";

/**
 * Chapter 03 — security as numbered clauses on a full-bleed receipt-ruled
 * panel. Amber footnote stamps the post-incident design stance.
 */
export function ThreatModel() {
  return (
    <section
      id="security"
      className="bg-receipt relative border-y border-line bg-bg-soft py-24 sm:py-32"
    >
      <Container>
        <LedgerHeading
          n="03"
          label="Threat model"
          title={
            <>
              Assume <span className="text-outline">hostile</span> input
            </>
          }
          blurb="Repo content, inbound issues, and chat history are all untrusted by default. The sandbox is the trust boundary — not the model's judgment."
        />

        <BatchReveal className="mt-14 grid gap-x-12 sm:grid-cols-2">
          {site.securityPoints.map((p, i) => (
            <div
              key={p.title}
              className="grid grid-cols-[3rem_1fr] gap-4 border-b border-line py-7"
            >
              <span className="label-mono pt-1 text-primary">
                ¶{String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-tight">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {p.body}
                </p>
              </div>
            </div>
          ))}
        </BatchReveal>

        <Reveal>
          <div className="mt-12 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <p className="max-w-xl text-sm text-muted">
              Quarantine for inbound issues, read-only tokens for verification
              runs, egress allowlisted to Anthropic + GitHub.
            </p>
            <span className="stamp rotate-2">
              Designed after Comment &amp; Control
            </span>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
