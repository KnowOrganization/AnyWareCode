import Link from "next/link";
import { getGuildsByIds } from "@anywherecode/db";
import { auth, signIn } from "@/auth";
import { db } from "@/lib/db";
import { fetchManagedGuilds } from "@/lib/guilds";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/ui/Container";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { INSTALL_URL } from "@/lib/site";

export default async function Dashboard() {
  const session = await auth();

  if (!session?.accessToken) {
    return (
      <PageShell>
        <Container className="max-w-md">
          <GlassCard ring className="flex flex-col items-center gap-5 p-9 text-center">
            <Badge>Discord OAuth</Badge>
            <h1 className="font-display text-3xl font-semibold">Dashboard</h1>
            <p className="text-muted">
              Sign in with Discord to manage the servers you administer and their
              billing.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("discord", { redirectTo: "/dashboard" });
              }}
            >
              <Button type="submit" variant="primary" size="lg">
                Sign in with Discord
              </Button>
            </form>
          </GlassCard>
        </Container>
      </PageShell>
    );
  }

  const managed = await fetchManagedGuilds(session.accessToken);
  const installed = await getGuildsByIds(
    db,
    managed.map((g) => g.id),
  );
  const installedIds = new Set(installed.map((g) => g.id));
  const withBot = managed.filter((g) => installedIds.has(g.id));
  const withoutBot = managed.filter((g) => !installedIds.has(g.id));

  return (
    <PageShell>
      <Container className="max-w-3xl">
        <div className="flex flex-col gap-2">
          <Badge>Your servers</Badge>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Servers you{" "}
            <span className="text-gradient">manage</span>
          </h1>
          <p className="text-muted">
            Servers where you have Manage Server permission and AnywhereCode is
            installed.
          </p>
        </div>

        {withBot.length === 0 ? (
          <GlassCard className="mt-8 p-6 text-muted">
            No servers with AnywhereCode yet. Add it to one below.
          </GlassCard>
        ) : (
          <ul className="mt-8 flex flex-col gap-3">
            {withBot.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/dashboard/${g.id}`}
                  className="group glass flex items-center justify-between rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
                >
                  <span className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo/30 to-violet/20 font-display text-lg">
                      {g.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-lg font-medium">{g.name}</span>
                  </span>
                  <span className="text-muted transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {withoutBot.length > 0 && (
          <div className="mt-12">
            <h2 className="font-display text-xl font-semibold">
              Add to another server
            </h2>
            <p className="mt-1 text-sm text-muted">
              You manage {withoutBot.length} more server
              {withoutBot.length === 1 ? "" : "s"} without the bot.
            </p>
            <div className="mt-4">
              <Button variant="primary" href={INSTALL_URL}>
                Add to Discord
              </Button>
            </div>
          </div>
        )}
      </Container>
    </PageShell>
  );
}
