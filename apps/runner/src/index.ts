import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  hostMessageSchema,
  taskSpecSchema,
  type TaskSpec,
} from "@anywherecode/shared";
import { ClaudeAgent } from "./agent.js";
import {
  checkoutTaskBranch,
  cloneRepo,
  commitAndPush,
  diffSummary,
} from "./git.js";
import { emit, readLines, redactSecrets, registerSecret } from "./io.js";

const WORK_ROOT = "/work";

async function main(): Promise<void> {
  const lines = readLines(process.stdin);
  const first = await lines.next();
  if (first.done) throw new Error("no TaskSpec on stdin");
  const spec: TaskSpec = taskSpecSchema.parse(JSON.parse(first.value));

  // Register secrets for redaction before any error paths.
  registerSecret(spec.githubToken);
  registerSecret(spec.llmAuth.token);

  // Clear all credential env vars then set exactly one set based on provider.
  // Setting multiple credential env vars causes the SDK to reject the request.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_MODEL;

  switch (spec.llmAuth.type) {
    case "anthropic_api_key":
      process.env.ANTHROPIC_API_KEY = spec.llmAuth.token;
      break;
    case "claude_oauth":
      process.env.CLAUDE_CODE_OAUTH_TOKEN = spec.llmAuth.token;
      break;
    case "custom":
      process.env.ANTHROPIC_BASE_URL = spec.llmAuth.baseUrl;
      process.env.ANTHROPIC_AUTH_TOKEN = spec.llmAuth.token;
      process.env.ANTHROPIC_MODEL = spec.llmAuth.model;
      break;
  }

  const workdir = path.join(WORK_ROOT, "repo");
  await mkdir(WORK_ROOT, { recursive: true });
  const gitCtx = { workdir, repo: spec.repo, token: spec.githubToken };

  await cloneRepo(gitCtx, spec.baseBranch, WORK_ROOT);
  if (spec.mode === "code") {
    await checkoutTaskBranch(gitCtx, spec.branch, spec.resumeBranch);
  }

  const agent = new ClaudeAgent();

  // Forward host messages (thread replies, cancel) into the agent.
  void (async () => {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const parsed = hostMessageSchema.safeParse(JSON.parse(line));
      if (!parsed.success) continue;
      if (parsed.data.type === "cancel") {
        agent.cancel();
        return;
      }
      agent.pushUserMessage(parsed.data.author, parsed.data.text);
    }
  })().catch(() => agent.cancel());

  let summary: string | undefined;
  for await (const event of agent.run(spec, workdir)) {
    if (event.type === "done") {
      summary = event.summary;
      continue; // emitted last, after the push
    }
    emit(event);
  }

  if (spec.mode === "code") {
    const commitMessage =
      spec.prompt.split("\n")[0]?.slice(0, 72) || spec.branch;
    const pushed = await commitAndPush(gitCtx, spec.branch, commitMessage);
    if (pushed) {
      emit({ type: "pushed", branch: spec.branch });
      const files = await diffSummary(gitCtx, spec.baseBranch);
      if (files && files.length > 0) emit({ type: "diff_summary", files });
    }
  }
  emit({ type: "done", summary });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: redactSecrets(raw) });
    process.exit(1);
  });
