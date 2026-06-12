import Link from "next/link";
import { redirect } from "next/navigation";
import { getGuild } from "@anywherecode/db";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userInGuild } from "@/lib/guilds";
import { packPurchasable, planView } from "@/lib/plan";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { PackBuyButton } from "./PackBuyButton";

/**
 * Community-funded compute. Any member of the server can buy a task pack for
 * it — Discord-boost style. This page is the target of the bot's cap-hit link.
 */
export default async function PackPage({
  params,
  searchParams,
}: {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ powered?: string }>;
}) {
  const { guildId } = await params;
  const { powered } = await searchParams;
  const session = await auth();
  if (!session?.accessToken) redirect("/api/auth/signin");

  const [isMember, guild] = await Promise.all([
    userInGuild(session.accessToken, guildId),
    getGuild(db, guildId),
  ]);

  if (!isMember || !guild) {
    return (
      <PageShell>
        <Container className="max-w-2xl">
          <GlassCard className="p-6">
            <p>
              {guild
                ? "You need to be a member of that server to power it."
                : "AnywhereCode isn't installed on that server yet."}
            </p>
            <Link href="/" className="mt-3 inline-block text-violet hover:text-fg">
              ← Home
            </Link>
          </GlassCard>
        </Container>
      </PageShell>
    );
  }

  const view = planView(guild);

  return (
    <PageShell>
      <Container className="max-w-2xl">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Power this server
        </h1>
        <p className="mt-3 text-muted">
          Task packs add 50 code tasks to the server&apos;s shared pool — bought
          by anyone, used by everyone. Your name gets the credit in the server.
        </p>

        <GlassCard ring className="mt-8 p-6 sm:p-7">
          {powered ? (
            <p className="text-lg font-semibold text-mint">
              🔋 Pack purchased — thanks for powering the server! The bot will
              announce your contribution shortly.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <Badge>Plan</Badge>
                  <p className="mt-2 font-display text-2xl font-semibold">
                    {view.tier}
                  </p>
                </div>
                <p className="font-mono text-sm text-muted">
                  {view.codeUsed}/{view.codeCap} plan tasks used ·{" "}
                  {view.packRemaining} pack task(s) left
                </p>
              </div>
              <div className="mt-6">
                {packPurchasable(guild) ? (
                  <PackBuyButton guildId={guildId} />
                ) : (
                  <p className="text-sm text-muted">
                    Task packs need an active plan first (OSS Community, Pro, or
                    Studio). Ask a server admin to pick one on the dashboard.
                  </p>
                )}
              </div>
            </>
          )}
        </GlassCard>
      </Container>
    </PageShell>
  );
}
