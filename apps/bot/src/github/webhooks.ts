import type { Client } from "discord.js";
import { and, eq } from "drizzle-orm";
import { schema, type Db, type Guild } from "@anywherecode/db";
import type { Config } from "../config.js";
import { handleIssueEvent } from "../discord/issue-feed.js";
import { applyPreviewToCard } from "../discord/preview-card.js";
import { postShipLog } from "../discord/shiplog.js";
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

  // Ship Log trigger B: an agent PR merged on GitHub (not via the Merge
  // button). Matching a task row by guild+repo+PR number IS the
  // "was-this-an-agent-PR" test; postShipLog's atomic claim dedups the race
  // with the button trigger.
  webhooks.on("pull_request.closed", ({ payload }) => {
    if (!payload.installation || !payload.pull_request.merged) return;
    void (async () => {
      const guilds = await guildsForInstallation(deps.db, payload.installation!.id);
      for (const guild of guilds) {
        const task = await deps.db.query.tasks.findFirst({
          where: and(
            eq(schema.tasks.guildId, guild.id),
            eq(schema.tasks.repoFullName, payload.repository.full_name),
            eq(schema.tasks.prNumber, payload.pull_request.number),
          ),
        });
        if (!task) continue;
        await postShipLog(
          { db: deps.db, client: deps.client },
          task,
          payload.pull_request.merged_by?.login ?? null,
        );
      }
    })().catch((err) => log.warn({ err }, "ship log webhook failed"));
  });

  // Proactive previews: a deploy succeeded → find the PRs on that commit →
  // upgrade matching agent PR cards' Preview button to a live link.
  webhooks.on("deployment_status", ({ payload }) => {
    if (!payload.installation) return;
    const url = payload.deployment_status.environment_url;
    if (payload.deployment_status.state !== "success" || !url) return;
    void (async () => {
      const installationId = payload.installation!.id;
      const repoFullName = payload.repository.full_name;
      const client = await deps.github.installationClient(installationId);
      const { data: prs } =
        await client.rest.repos.listPullRequestsAssociatedWithCommit({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          commit_sha: payload.deployment.sha,
        });
      if (prs.length === 0) return;
      const guilds = await guildsForInstallation(deps.db, installationId);
      for (const guild of guilds) {
        for (const pr of prs) {
          const task = await deps.db.query.tasks.findFirst({
            where: and(
              eq(schema.tasks.guildId, guild.id),
              eq(schema.tasks.repoFullName, repoFullName),
              eq(schema.tasks.prNumber, pr.number),
            ),
          });
          if (!task || task.previewUrl === url) continue;
          await applyPreviewToCard({ db: deps.db, client: deps.client }, task, url);
        }
      }
    })().catch((err) => log.warn({ err }, "preview webhook failed"));
  });
}
