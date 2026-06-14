import { and, eq, inArray } from "drizzle-orm";
import {
  guildIdsForInstallation,
  removeGuildInstallation,
  schema,
  type Db,
  type Guild,
} from "@anywarecode/db";
import { handleIssueEvent } from "../discord/issue-feed.js";
import type { BotContext } from "../discord/interactions.js";
import { applyPreviewToCard } from "../discord/preview-card.js";
import { handleAutoReview } from "../discord/review.js";
import { postShipLog } from "../discord/shiplog.js";
import { findAnnounceChannel } from "../discord/welcome.js";
import { log } from "../observability.js";

/**
 * GitHub webhook → Discord features (issue feed, ship log, previews,
 * auto-review). The HTTP layer (http/server.ts) owns delivery dedup and HMAC
 * verification; this module owns event routing. Handlers must never throw —
 * GitHub gets its 200 from the route, and a handler failure on one guild must
 * not poison the fan-out to others.
 */

export type WebhookDeps = BotContext;

/** All guilds linked to an installation (a guild may also link several). */
export async function guildsForInstallation(
  db: Db,
  installationId: number,
): Promise<Guild[]> {
  const guildIds = await guildIdsForInstallation(db, installationId);
  if (guildIds.length === 0) return [];
  return db.query.guilds.findMany({
    where: inArray(schema.guilds.id, guildIds),
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

  // Auto-review: every opened/ready human PR on opted-in repos gets a
  // read-only review thread + summary card.
  webhooks.on(
    ["pull_request.opened", "pull_request.ready_for_review"],
    ({ payload }) => {
      if (!payload.installation) return;
      void handleAutoReview(
        deps,
        payload.installation.id,
        payload.repository.full_name,
        {
          number: payload.pull_request.number,
          isDraft: Boolean(payload.pull_request.draft),
          headRef: payload.pull_request.head.ref,
        },
      ).catch((err) => log.warn({ err }, "auto-review webhook failed"));
    },
  );

  // GitHub-side uninstall: drop the link (and its channel bindings) in every
  // guild that had it, and tell them.
  webhooks.on("installation.deleted", ({ payload }) => {
    const installationId = payload.installation.id;
    void (async () => {
      const guildIds = await guildIdsForInstallation(deps.db, installationId);
      for (const guildId of guildIds) {
        await removeGuildInstallation(deps.db, guildId, installationId);
        const guild = await deps.client.guilds.fetch(guildId).catch(() => null);
        const channel = guild ? findAnnounceChannel(guild) : null;
        await channel
          ?.send({
            content: `🔌 The GitHub installation for **${
              (payload.installation.account as { login?: string } | null)
                ?.login ?? "an account"
            }** was uninstalled on GitHub — its repos and channel bindings were unlinked here.`,
            allowedMentions: { parse: [] },
          })
          .catch(() => {});
      }
    })().catch((err) => log.warn({ err }, "installation.deleted cleanup failed"));
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
