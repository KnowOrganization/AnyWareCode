import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <PageShell>
      <Container className="max-w-2xl">
        <Badge>Legal</Badge>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
          Terms of Service
        </h1>
        <GlassCard className="mt-6 p-6 leading-relaxed text-muted sm:p-7">
          <p>
            Placeholder. Finalize before public launch (Phase 4): acceptable use,
            liability, bring-your-own-LLM responsibility, and
            subscription/refund terms.
          </p>
        </GlassCard>
      </Container>
    </PageShell>
  );
}
