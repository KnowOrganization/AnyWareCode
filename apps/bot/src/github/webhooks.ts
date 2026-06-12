import type { Client } from "discord.js";
import { eq } from "drizzle-orm";
import { schema, type Db, type Guild } from "@anywherecode/db";
import type { Config } from "../config.js";
import { log } from "../observability.js";
import type { GitHubService } from "./app.js";

/**
 * GitHub webhook → Discord features (issue feed, ship log, previews,
 * auto-review). The HTTP layer (http/server.ts) owns delivery dedup and HMAC
 * verification; this module owns event routing. Handlers must never throw —
 * GitHub gets its 200 from the route, and a handler failure on one guild must
 * not poison the fan-out to others.
 */

export interface WebhookDeps {
  db: Db;
  config: Config;
  github: GitHubService;
  client: Client;
}

/** All guilds linked to an installation (uniqueness is not enforced). */
export async function guildsForInstallation(
  db: Db,
  installationId: number,
): Promise<Guild[]> {
  return db.query.guilds.findMany({
    where: eq(schema.guilds.githubInstallationId, installationId),
  });
}

export function registerWebhookHandlers(deps: WebhookDeps): void {
  if (!deps.config.GITHUB_WEBHOOK_SECRET) return;
  const { webhooks } = deps.github;

  webhooks.onError((err) => {
    log.warn({ err: err.message }, "webhook handler error");
  });
}
