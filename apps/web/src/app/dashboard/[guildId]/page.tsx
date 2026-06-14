import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getChannelReposForGuild, getGuild } from "@anywarecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userManagesGuild } from "@/lib/guilds";
import { planView } from "@/lib/plan";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { BillingButtons } from "./BillingButtons";

function Meter({ used, cap, accent }: { used: number; cap: number; accent: string }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full ${accent}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default async function GuildPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  const session = await auth();
  if (!session?.accessToken) redirect("/dashboard");

  if (!(await userManagesGuild(session.accessToken, guildId))) {
    return (
      <PageShell>
        <Container className="max-w-2xl">
          <GlassCard className="p-6">
            <p>You don&apos;t manage that server.</p>
            <Link href="/dashboard" className="mt-3 inline-block text-violet hover:text-fg">
              ← Back to servers
            </Link>
          </GlassCard>
        </Container>
      </PageShell>
    );
  }

  const guild = await getGuild(db, guildId);
  if (!guild) {
    return (
      <PageShell>
        <Container className="max-w-2xl">
          <GlassCard className="p-6">
            <p>AnyWareCode isn&apos;t installed on that server yet.</p>
            <Link href="/dashboard" className="mt-3 inline-block text-violet hover:text-fg">
              ← Back to servers
            </Link>
          </GlassCard>
        </Container>
      </PageShell>
    );
  }

  const view = planView(guild);
  const repos = await getChannelReposForGuild(db, guildId);

  const tierTone =
    view.status === "active"
      ? "text-mint"
      : view.status === "past_due"
        ? "text-pink"
        : "text-cyan";

  return (
    <PageShell>
      <Container className="max-w-3xl">
        <Link
          href="/dashboard"
          className="text-sm text-muted transition-colors hover:text-fg"
        >
          ← All servers
        </Link>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
          Server settings
        </h1>

        <div className="mt-8 flex flex-col gap-5">
          {/* Plan */}
          <GlassCard ring className="p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Badge>Plan</Badge>
                <p className={`mt-3 font-display text-3xl font-semibold ${tierTone}`}>
                  {view.tier}
                </p>
                {view.renewsAt && (
                  <p className="mt-1 text-sm text-muted">
                    Renews {view.renewsAt.toDateString()}.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6">
              <BillingButtons
                guildId={guildId}
                isActive={view.status === "active"}
                managedInDiscord={guild.subSource === "discord"}
                defaultCurrency={
                  ((await headers()).get("x-vercel-ip-country") ?? "").toUpperCase() === "IN"
                    ? "INR"
                    : "USD"
                }
              />
            </div>
          </GlassCard>

          {/* Usage */}
          <GlassCard className="p-6 sm:p-7">
            <Badge>Usage this month</Badge>
            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">Code tasks</span>
                  <span className="font-mono">
                    {view.codeUsed}
                    <span className="text-faint">/{view.codeCap}</span>
                  </span>
                </div>
                <Meter
                  used={view.codeUsed}
                  cap={view.codeCap}
                  accent="bg-gradient-to-r from-indigo to-violet"
                />
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted">Questions (/ask)</span>
                  <span className="font-mono">
                    {view.askUsed}
                    <span className="text-faint">/∞</span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-mint">Unlimited on every plan.</p>
              </div>
            </div>
            <p className="mt-5 text-sm text-muted">
              🔋 {view.packRemaining} pack task(s) in reserve —{" "}
              <Link
                href={`/packs/${guildId}`}
                className="text-violet hover:text-fg"
              >
                any member can add more
              </Link>
              .
            </p>
          </GlassCard>

          {/* Repo bindings */}
          <GlassCard className="p-6 sm:p-7">
            <Badge>Channel → repo bindings</Badge>
            {repos.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                None yet. Run{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-fg">
                  /repo set
                </code>{" "}
                in a channel.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {repos.map((r) => (
                  <li
                    key={r.channelId}
                    className="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 font-mono text-sm"
                  >
                    <span className="text-faint">#{r.channelId}</span>
                    <span className="text-muted">→</span>
                    <strong className="font-semibold text-fg">{r.repoFullName}</strong>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </div>
      </Container>
    </PageShell>
  );
}
