import { App, type Octokit } from "octokit";
import type { Config } from "../config.js";

export class GitHubService {
  private app: App;

  constructor(private config: Config) {
    this.app = new App({
      appId: config.GITHUB_APP_ID,
      privateKey: config.GITHUB_APP_PRIVATE_KEY,
    });
  }

  installUrl(state: string): string {
    return `https://github.com/apps/${this.config.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
  }

  async installationClient(installationId: number): Promise<Octokit> {
    return this.app.getInstallationOctokit(installationId);
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
