import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BOT_NAME = "AnywhereCode[bot]";
const BOT_EMAIL = "anywherecode[bot]@users.noreply.github.com";
const ASKPASS_PATH = "/usr/local/bin/git-askpass.sh";

export interface GitContext {
  workdir: string;
  repo: string;
  token: string;
}

/**
 * Remote URL carries only the username; the token is supplied per-command via
 * GIT_ASKPASS. So the token never lands in the remote URL, in .git/config, or
 * in `ps`/cmdline — and because GIT_PAT is set only on git's own env (not the
 * runner's process.env), the agent's bash tool can't read it either.
 */
function remoteUrl(ctx: GitContext): string {
  return `https://x-access-token@github.com/${ctx.repo}.git`;
}

async function git(
  ctx: GitContext,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", `user.name=${BOT_NAME}`, "-c", `user.email=${BOT_EMAIL}`, ...args],
    {
      cwd: opts.cwd ?? ctx.workdir,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: ASKPASS_PATH,
        GIT_PAT: ctx.token,
      },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout.trim();
}

export async function cloneRepo(
  ctx: GitContext,
  baseBranch: string,
  parentDir: string,
): Promise<void> {
  await git(
    ctx,
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      baseBranch,
      remoteUrl(ctx),
      ctx.workdir,
    ],
    { cwd: parentDir },
  );
}

export async function checkoutTaskBranch(
  ctx: GitContext,
  branch: string,
  resume: boolean,
): Promise<void> {
  if (resume) {
    await git(ctx, ["fetch", "--depth", "1", "origin", branch]);
    await git(ctx, ["checkout", "-B", branch, `origin/${branch}`]);
  } else {
    await git(ctx, ["checkout", "-b", branch]);
  }
}

/**
 * Per-file change stats vs the base branch (best-effort: shallow histories may
 * lack a merge-base; callers treat null as "no summary").
 */
export async function diffSummary(
  ctx: GitContext,
  baseBranch: string,
): Promise<Array<{ path: string; additions: number; deletions: number }> | null> {
  try {
    const out = await git(ctx, [
      "diff",
      "--numstat",
      `origin/${baseBranch}...HEAD`,
    ]);
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [a, d, ...rest] = line.split("\t");
      return {
        path: rest.join("\t") || "?",
        // Binary files show "-": count as 0.
        additions: Number.parseInt(a ?? "0", 10) || 0,
        deletions: Number.parseInt(d ?? "0", 10) || 0,
      };
    });
  } catch {
    return null;
  }
}

/** Commit everything and push the task branch. Returns false if no changes. */
export async function commitAndPush(
  ctx: GitContext,
  branch: string,
  message: string,
): Promise<boolean> {
  await git(ctx, ["add", "-A"]);
  const status = await git(ctx, ["status", "--porcelain"]);
  const hasStagedChanges = status.length > 0;
  if (hasStagedChanges) {
    await git(ctx, ["commit", "-m", message]);
  }
  // On resume there may be agent-made commits even when the tree is clean now.
  const unpushed = await git(ctx, [
    "rev-list",
    "--count",
    `origin/${branch}..HEAD`,
  ]).catch(() => (hasStagedChanges ? "1" : "0"));
  if (!hasStagedChanges && unpushed === "0") return false;
  await git(ctx, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  return true;
}
