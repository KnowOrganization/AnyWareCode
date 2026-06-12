import { App, type Octokit } from "octokit";
import type { Config } from "../config.js";

export class GitHubService {
  private app: App;

  constructor(private config: Config) {
    this.app = new App({
      appId: config.GITHUB_APP_ID,
      privateKey: config.GITHUB_APP_PRIVATE_KEY,
      ...(config.GITHUB_WEBHOOK_SECRET
        ? { webhooks: { secret: config.GITHUB_WEBHOOK_SECRET } }
        : {}),
    });
  }

  /** Octokit webhooks (typed handlers + timing-safe verifyAndReceive).
   * Only valid when GITHUB_WEBHOOK_SECRET is configured. */
  get webhooks(): App["webhooks"] {
    return this.app.webhooks;
  }

  installUrl(state: string): string {
    return `https://github.com/apps/${this.config.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
  }

  async installationClient(installationId: number): Promise<Octokit> {
    return this.app.getInstallationOctokit(installationId);
  }

  /**
   * Confirms this App actually owns `installationId` by reading it with the
   * App JWT. The install callback gets `installation_id` straight from the
   * query string, so without this check a valid state could be paired with an
   * attacker-chosen installation. Returns the installation owner's login on
   * success (org or user — used for one-trial-per-org), null on any failure.
   */
  async validateInstallation(
    installationId: number,
  ): Promise<{ accountLogin: string | null } | null> {
    try {
      const { data } = await this.app.octokit.rest.apps.getInstallation({
        installation_id: installationId,
      });
      const account = data.account as { login?: string } | null;
      return { accountLogin: account?.login ?? null };
    } catch {
      return null;
    }
  }

  /** Short-lived token scoped to a single repo, for the runner's git ops. */
  async mintRepoToken(
    installationId: number,
    repoFullName: string,
  ): Promise<string> {
    const [, repo] = splitRepo(repoFullName);
    const { data } = await this.app.octokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
      repositories: [repo],
      permissions: { contents: "write", metadata: "read" },
    });
    return data.token;
  }

  async listRepos(installationId: number): Promise<string[]> {
    const client = await this.installationClient(installationId);
    const repos = await client.paginate(
      client.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    return repos.map((r) => r.full_name);
  }

  /** Repo names + visibility; the OSS tier requires every repo public. */
  async listReposWithVisibility(
    installationId: number,
  ): Promise<Array<{ fullName: string; private: boolean }>> {
    const client = await this.installationClient(installationId);
    const repos = await client.paginate(
      client.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    return repos.map((r) => ({ fullName: r.full_name, private: r.private }));
  }

  /** Lazy OSS recheck at launch time. Unknown/unreadable counts as private. */
  async repoIsPrivate(
    installationId: number,
    repoFullName: string,
  ): Promise<boolean> {
    const [owner, repo] = splitRepo(repoFullName);
    try {
      const client = await this.installationClient(installationId);
      const { data } = await client.rest.repos.get({ owner, repo });
      return data.private;
    } catch {
      return true;
    }
  }

  async defaultBranch(
    installationId: number,
    repoFullName: string,
  ): Promise<string> {
    const [owner, repo] = splitRepo(repoFullName);
    const client = await this.installationClient(installationId);
    const { data } = await client.rest.repos.get({ owner, repo });
    return data.default_branch;
  }

  async createPullRequest(params: {
    installationId: number;
    repoFullName: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  }): Promise<{ number: number; url: string }> {
    const [owner, repo] = splitRepo(params.repoFullName);
    const client = await this.installationClient(params.installationId);
    const { data } = await client.rest.pulls.create({
      owner,
      repo,
      head: params.branch,
      base: params.baseBranch,
      title: params.title,
      body: params.body,
    });
    return { number: data.number, url: data.html_url };
  }

  async mergePullRequest(
    installationId: number,
    repoFullName: string,
    prNumber: number,
  ): Promise<void> {
    const [owner, repo] = splitRepo(repoFullName);
    const client = await this.installationClient(installationId);
    await client.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: "squash",
    });
  }

  /** Everything the review agent needs about a PR, including its diff. */
  async pullRequestForReview(
    installationId: number,
    repoFullName: string,
    prNumber: number,
  ): Promise<{
    title: string;
    body: string;
    author: string;
    headRef: string;
    baseRef: string;
    isFork: boolean;
    isDraft: boolean;
    isOpen: boolean;
    diff: string;
  }> {
    const [owner, repo] = splitRepo(repoFullName);
    const client = await this.installationClient(installationId);
    const [{ data: pr }, diffRes] = await Promise.all([
      client.rest.pulls.get({ owner, repo, pull_number: prNumber }),
      client.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      }),
    ]);
    // With format=diff the payload is the raw diff string.
    const rawDiff = diffRes.data as unknown as string;
    const MAX_DIFF = 50_000;
    const diff =
      rawDiff.length > MAX_DIFF
        ? `${rawDiff.slice(0, MAX_DIFF)}\n…(diff truncated at ${MAX_DIFF} chars)`
        : rawDiff;
    return {
      title: pr.title,
      body: pr.body ?? "",
      author: pr.user?.login ?? "unknown",
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      isFork: pr.head.repo?.full_name !== repoFullName,
      isDraft: Boolean(pr.draft),
      isOpen: pr.state === "open",
      diff,
    };
  }

  /** Review + review-comment text, used as context for the Iterate flow. */
  async pullRequestFeedback(
    installationId: number,
    repoFullName: string,
    prNumber: number,
  ): Promise<Array<{ author: string; text: string }>> {
    const [owner, repo] = splitRepo(repoFullName);
    const client = await this.installationClient(installationId);
    const [reviews, comments] = await Promise.all([
      client.rest.pulls.listReviews({ owner, repo, pull_number: prNumber }),
      client.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNumber,
      }),
    ]);
    const feedback: Array<{ author: string; text: string }> = [];
    for (const review of reviews.data) {
      if (review.body) {
        feedback.push({
          author: review.user?.login ?? "reviewer",
          text: review.body,
        });
      }
    }
    for (const comment of comments.data) {
      feedback.push({
        author: comment.user?.login ?? "reviewer",
        text: `${comment.path}: ${comment.body}`,
      });
    }
    return feedback;
  }
}

export function splitRepo(repoFullName: string): [string, string] {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`invalid repo name: ${repoFullName}`);
  return [owner, repo];
}
