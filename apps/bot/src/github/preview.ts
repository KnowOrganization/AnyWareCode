import type { GitHubService } from "./app.js";
import { splitRepo } from "./app.js";

/**
 * Preview-deploy discovery: read-only probing of GitHub's deployment surface
 * for a commit — no Vercel/Netlify tokens, whatever CI already publishes.
 * Probe order: deployments (environment_url) → commit statuses (target_url on
 * a deploy-ish context) → check runs (details_url).
 */

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { url: string | null; at: number }>();

const DEPLOYISH = /deploy|vercel|netlify|pages|preview/i;

export async function findPreviewUrl(
  github: GitHubService,
  installationId: number,
  repoFullName: string,
  sha: string,
): Promise<string | null> {
  const key = `${repoFullName}@${sha}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.url;

  const [owner, repo] = splitRepo(repoFullName);
  const client = await github.installationClient(installationId);
  let url: string | null = null;

  try {
    const { data: deployments } = await client.rest.repos.listDeployments({
      owner,
      repo,
      sha,
      per_page: 5,
    });
    for (const d of deployments) {
      const { data: statuses } = await client.rest.repos.listDeploymentStatuses({
        owner,
        repo,
        deployment_id: d.id,
        per_page: 5,
      });
      const success = statuses.find(
        (s) => s.state === "success" && s.environment_url,
      );
      if (success?.environment_url) {
        url = success.environment_url;
        break;
      }
    }

    if (!url) {
      const { data: combined } = await client.rest.repos.getCombinedStatusForRef({
        owner,
        repo,
        ref: sha,
      });
      const status = combined.statuses.find(
        (s) => s.state === "success" && s.target_url && DEPLOYISH.test(s.context),
      );
      url = status?.target_url ?? null;
    }

    if (!url) {
      const { data: checks } = await client.rest.checks.listForRef({
        owner,
        repo,
        ref: sha,
        per_page: 50,
      });
      const run = checks.check_runs.find(
        (c) =>
          c.conclusion === "success" && c.details_url && DEPLOYISH.test(c.name),
      );
      url = run?.details_url ?? null;
    }
  } catch {
    url = null;
  }

  cache.set(key, { url, at: Date.now() });
  return url;
}

export async function prHeadSha(
  github: GitHubService,
  installationId: number,
  repoFullName: string,
  prNumber: number,
): Promise<string | null> {
  const [owner, repo] = splitRepo(repoFullName);
  try {
    const client = await github.installationClient(installationId);
    const { data } = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return data.head.sha;
  } catch {
    return null;
  }
}
