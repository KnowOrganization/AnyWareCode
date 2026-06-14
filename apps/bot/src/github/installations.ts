import {
  listGuildInstallations,
  type Db,
  type GuildInstallation,
} from "@anywarecode/db";
import type { GitHubService } from "./app.js";

/**
 * Multi-installation resolution. A guild may link several GitHub App
 * installations (personal account + orgs); most paths read an installation id
 * STAMPED at creation time (channel binding, task row, proposal row) — this
 * module is the source for those stamps and the belt-and-braces fallback for
 * anything unstamped.
 */

export async function listInstallations(
  db: Db,
  guildId: string,
): Promise<GuildInstallation[]> {
  return listGuildInstallations(db, guildId);
}

export async function hasInstallation(
  db: Db,
  guildId: string,
): Promise<boolean> {
  return (await listGuildInstallations(db, guildId)).length > 0;
}

const probeCache = new Map<string, { id: number | null; at: number }>();
const PROBE_TTL_MS = 30_000;

/**
 * Which linked installation owns this repo? Order: single installation →
 * trivially it; an existing channel binding for the repo; else probe each
 * installation (linkedAt order — deterministic when two installations can
 * both see a repo). Null = no linked installation has access.
 */
export async function resolveInstallationForRepo(
  db: Db,
  github: GitHubService,
  guildId: string,
  repoFullName: string,
): Promise<number | null> {
  const installations = await listGuildInstallations(db, guildId);
  if (installations.length === 0) return null;
  if (installations.length === 1) return installations[0]?.installationId ?? null;

  const bound = await db.query.channelRepos.findFirst({
    where: (t, { and, eq, isNotNull }) =>
      and(
        eq(t.guildId, guildId),
        eq(t.repoFullName, repoFullName),
        isNotNull(t.installationId),
      ),
  });
  if (bound?.installationId) return bound.installationId;

  const cacheKey = `${guildId}:${repoFullName}`;
  const hit = probeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.id;
  let resolved: number | null = null;
  for (const installation of installations) {
    const repos = await github
      .listRepos(installation.installationId)
      .catch(() => [] as string[]);
    if (repos.includes(repoFullName)) {
      resolved = installation.installationId;
      break;
    }
  }
  probeCache.set(cacheKey, { id: resolved, at: Date.now() });
  return resolved;
}
