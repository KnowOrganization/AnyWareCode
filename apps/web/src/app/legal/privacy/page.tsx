import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <PageShell>
      <Container className="max-w-2xl">
        <Badge>Legal</Badge>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <GlassCard className="mt-6 p-6 leading-relaxed text-muted sm:p-7">
          <p>
            Placeholder. Finalize before public launch (Phase 4). Task prompts and
            repo content transit the LLM provider each server configures
            (bring-your-own key). Stored data: encrypted LLM credentials, task
            history, and usage counters. Removing the bot deletes a server&apos;s
            data.
          </p>
        </GlassCard>
      </Container>
    </PageShell>
  );
}
