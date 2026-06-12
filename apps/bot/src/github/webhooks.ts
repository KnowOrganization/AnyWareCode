import type { Client } from "discord.js";
import { eq } from "drizzle-orm";
import { schema, type Db, type Guild } from "@anywherecode/db";
import type { Config } from "../config.js";
import { handleIssueEvent } from "../discord/issue-feed.js";
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

  // Issue-to-Proposal: `opened` for unfiltered feeds; `labeled` so label-gated
  // feeds surface issues when the matching label lands later. Pending-proposal
  // dedup keeps the pair from double-posting.
  webhooks.on(["issues.opened", "issues.labeled"], ({ payload }) => {
    if (!payload.installation) return;
    const issue = payload.issue;
    void handleIssueEvent(
      deps,
      payload.installation.id,
      payload.repository.full_name,
      {
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        labels: (issue.labels ?? [])
          .map((l) => (typeof l === "string" ? l : (l?.name ?? "")))
          .filter(Boolean),
        authorAssociation: issue.author_association,
        authorIsBot: issue.user?.type === "Bot",
        isPullRequest: Boolean(
          (issue as { pull_request?: unknown }).pull_request,
        ),
      },
    );
  });
}
