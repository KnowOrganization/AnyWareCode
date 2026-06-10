import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  hostMessageSchema,
  taskSpecSchema,
  type TaskSpec,
} from "@anywherecode/shared";
import { ClaudeAgent } from "./agent.js";
import { checkoutTaskBranch, cloneRepo, commitAndPush } from "./git.js";
import { emit, readLines } from "./io.js";

const WORK_ROOT = "/work";

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const lines = readLines(process.stdin);
  const first = await lines.next();
  if (first.done) throw new Error("no TaskSpec on stdin");
  const spec: TaskSpec = taskSpecSchema.parse(JSON.parse(first.value));

  const workdir = path.join(WORK_ROOT, "repo");
  await mkdir(WORK_ROOT, { recursive: true });
  const gitCtx = { workdir, repo: spec.repo, token };

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
    const commitMessage = spec.prompt.split("\n")[0]?.slice(0, 72) || spec.branch;
    const pushed = await commitAndPush(gitCtx, spec.branch, commitMessage);
    if (pushed) emit({ type: "pushed", branch: spec.branch });
  }
  emit({ type: "done", summary });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Installation tokens must never reach Discord via error text.
    emit({ type: "error", message: message.replaceAll(/x-access-token:[^@]+@/g, "***@") });
    process.exit(1);
  });
