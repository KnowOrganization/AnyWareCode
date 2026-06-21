import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	hostMessageSchema,
	taskSpecSchema,
	type TaskSpec,
} from "@anywarecode/shared";
import { ClaudeAgent, type Agent } from "./agent.js";
import { ClawAgent } from "./claw.js";
import { credentialEnv } from "./credential-env.js";
import {
	checkoutTaskBranch,
	cloneRepo,
	commitAndPush,
	diffSummary,
} from "./git.js";
import { emit, readLines, redactSecrets, registerSecret } from "./io.js";
import { preflight } from "./preflight.js";
import { startTranslator, type TranslatorHandle } from "./translator.js";
import {
	budgetForVerify,
	buildRepairPrompt,
	detectChecks,
	runChecks,
} from "./verify.js";

const WORK_ROOT = "/work";

// OpenAI-compatible providers run behind a localhost Messages→Chat-Completions
// translation sidecar. It must stay up for the whole run; held at module scope
// so it can be closed both on the normal exit path and on error.
let activeTranslator: TranslatorHandle | undefined;

async function main(): Promise<void> {
	const startMs = Date.now();
	const lines = readLines(process.stdin);
	const first = await lines.next();
	if (first.done) throw new Error("no TaskSpec on stdin");
	const spec: TaskSpec = taskSpecSchema.parse(JSON.parse(first.value));

	// Register secrets for redaction before any error paths.
	registerSecret(spec.githubToken);
	registerSecret(spec.llmAuth.token);
	for (const server of spec.mcpServers) {
		for (const value of Object.values(server.headers ?? {})) {
			registerSecret(value);
		}
	}

	// Clear all credential env vars then set exactly one set based on provider.
	// Setting multiple credential env vars causes the SDK to reject the request.
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
	delete process.env.ANTHROPIC_AUTH_TOKEN;
	delete process.env.ANTHROPIC_BASE_URL;
	delete process.env.ANTHROPIC_MODEL;

	switch (spec.llmAuth.type) {
		case "anthropic_api_key":
		case "claude_oauth":
		case "custom":
			// Legacy (non-translator) arms: a pure, byte-for-byte mapping of the
			// auth type to the SDK's credential env vars (see credential-env.ts).
			Object.assign(process.env, credentialEnv(spec.llmAuth));
			break;
		case "openai":
		case "openrouter": {
			// Point the SDK at the translator (Messages → Chat Completions) and
			// forward the provider key + effective model; `ClaudeAgent` is unchanged.
			const upstreamBaseUrl =
				spec.llmAuth.type === "openai"
					? "https://api.openai.com"
					: "https://openrouter.ai/api";
			activeTranslator = await startTranslator({
				upstreamBaseUrl,
				apiKey: spec.llmAuth.token,
			});
			process.env.ANTHROPIC_BASE_URL = activeTranslator.url;
			process.env.ANTHROPIC_AUTH_TOKEN = spec.llmAuth.token;
			process.env.ANTHROPIC_MODEL = spec.llmAuth.model;
			break;
		}
	}

	// Preflight: fail fast with a clear message instead of a deep SDK error.
	const problems = preflight(spec);
	if (problems.length > 0) {
		throw new Error(`Preflight failed: ${problems.join("; ")}`);
	}

	const workdir = path.join(WORK_ROOT, "repo");
	await mkdir(WORK_ROOT, { recursive: true });
	const gitCtx = { workdir, repo: spec.repo, token: spec.githubToken };

	await cloneRepo(gitCtx, spec.baseBranch, WORK_ROOT);
	if (spec.mode === "code") {
		await checkoutTaskBranch(gitCtx, spec.branch, spec.resumeBranch);
	}

	// Engine selection happens behind the Agent seam — the bot only knows the
	// protocol. claw is opt-in and experimental; default is the Claude Agent SDK.
	const newAgent = (): Agent =>
		spec.engine === "claw" ? new ClawAgent() : new ClaudeAgent();

	// A mutable holder so repair turns can swap in a fresh agent while the host
	// control channel below always steers the one that's currently running.
	const agentRef: { current: Agent } = { current: newAgent() };
	let aborted = false;
	let summary: string | undefined;
	let planProposed = false;

	// Forward host messages (thread replies, control plane, cancel) into the agent.
	void (async () => {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let json: unknown;
			try {
				json = JSON.parse(line);
			} catch {
				continue;
			}
			const parsed = hostMessageSchema.safeParse(json);
			if (!parsed.success) continue;
			switch (parsed.data.type) {
				case "cancel":
					aborted = true;
					agentRef.current.cancel();
					return;
				case "interrupt":
					agentRef.current.interrupt();
					break;
				case "set_model":
					agentRef.current.setModel(parsed.data.model || undefined);
					emit({
						type: "model_changed",
						model: parsed.data.model || "default",
					});
					break;
				case "set_mode":
					agentRef.current.setPermissionMode(parsed.data.mode);
					break;
				case "user_message":
					agentRef.current.pushUserMessage(
						parsed.data.author,
						parsed.data.text,
					);
					break;
			}
		}
	})().catch((err: unknown) => {
		emit({
			type: "error",
			message: redactSecrets(
				`host message loop failed: ${err instanceof Error ? err.message : String(err)}`,
			),
		});
		agentRef.current.cancel();
	});

	async function drain(agent: Agent, runSpec: TaskSpec): Promise<void> {
		for await (const event of agent.run(runSpec, workdir)) {
			if (event.type === "done") {
				summary = event.summary;
				continue; // emitted last, after the push
			}
			if (event.type === "plan_proposed") planProposed = true;
			emit(event);
		}
	}

	await drain(agentRef.current, spec);

	// Plan mode: if the agent didn't call ExitPlanMode, surface its final summary
	// as the proposed plan so the host can still post approve buttons.
	if (spec.mode === "plan" && !planProposed && summary?.trim()) {
		emit({ type: "plan_proposed", text: summary.trim() });
	}

	// Verification + self-repair (code mode): run the project's checks, and on
	// failure feed them back to a fresh agent on the same working tree, up to the
	// tier-gated repair budget. The runner judges; the agent fixes.
	if (spec.mode === "code" && spec.verify?.enabled && !aborted) {
		const deadlineMs =
			startMs + (Number(process.env.TASK_TIMEOUT_MINUTES) || 30) * 60_000;
		const repairModel = process.env.VERIFY_REPAIR_MODEL?.trim();
		// Escalate to the stronger model only after this many failed repairs (cost).
		const escalateAfter = Number(process.env.VERIFY_ESCALATE_AFTER ?? "1");
		const maxAttempts = spec.verify.maxRepairAttempts ?? 0;
		for (let attempt = 0; !aborted; attempt++) {
			const detection = detectChecks(workdir, spec);
			if (detection.skipped) {
				emit({
					type: "check",
					name: "verify",
					passed: true,
					summary: detection.reason,
				});
				break;
			}
			const budget = budgetForVerify(deadlineMs, Date.now());
			if (!budget.canRun) {
				emit({
					type: "check",
					name: "verify",
					passed: true,
					summary: "skipped — time budget exhausted",
				});
				break;
			}
			const results = await runChecks(detection.checks, workdir, budget);
			for (const r of results) {
				emit({
					type: "check",
					name: r.name,
					passed: r.passed,
					summary: r.summary,
				});
			}
			const failures = results.filter((r) => !r.passed);
			if (failures.length === 0 || attempt >= maxAttempts || aborted) break;

			// Repair turn: fresh agent, same tree. Early repairs reuse the run's
			// model; escalate to the stronger model only after `escalateAfter` tries.
			const escalate =
				Boolean(repairModel) &&
				spec.llmAuth.type !== "custom" &&
				attempt >= escalateAfter;
			const useModel = escalate ? repairModel : spec.model;
			if (escalate && repairModel !== spec.model) {
				emit({ type: "model_changed", model: repairModel! });
			}
			const repairSpec: TaskSpec = {
				...spec,
				transcript: [],
				prompt: buildRepairPrompt(spec.prompt, failures),
				...(useModel ? { model: useModel } : {}),
			};
			agentRef.current = newAgent();
			await drain(agentRef.current, repairSpec);
		}
	}

	if (spec.mode === "code") {
		const subject = spec.prompt.split("\n")[0]?.slice(0, 72) || spec.branch;
		// Provenance trailers (who sponsored, where it was steered) travel on the
		// commit itself, not just the PR description.
		const trailers = spec.provenance?.trailers ?? [];
		const commitMessage =
			trailers.length > 0 ? `${subject}\n\n${trailers.join("\n")}` : subject;
		const pushed = await commitAndPush(gitCtx, spec.branch, commitMessage);
		if (pushed) {
			emit({ type: "pushed", branch: spec.branch });
			const files = await diffSummary(gitCtx, spec.baseBranch);
			if (files && files.length > 0) emit({ type: "diff_summary", files });
		}
	}
	emit({ type: "done", summary });
	await closeTranslator();
}

/**
 * Tear down the translation sidecar (if one was started) so its localhost
 * listener doesn't outlive the run. Safe to call more than once and never
 * throws — a close failure must not mask the task's own outcome.
 */
async function closeTranslator(): Promise<void> {
	const t = activeTranslator;
	activeTranslator = undefined;
	if (!t) return;
	try {
		await t.close();
	} catch {
		// best-effort: the process is exiting anyway.
	}
}

/**
 * stdout → the Docker attach socket is a PIPE, which Node writes asynchronously.
 * `process.exit()` does NOT drain it, so an immediate exit after the final
 * `emit({type:"done"})` truncates that line — the bot never sees `done` and
 * reports "agent stopped unexpectedly". Drain first, then exit.
 */
function flushAndExit(code: number): never | void {
	const done = (): never => process.exit(code);
	if (process.stdout.writableLength === 0) return done();
	process.stdout.once("drain", done);
	setTimeout(done, 2000).unref(); // safety: never hang if drain never fires
}

// Last-resort handlers: an uncaught exception or unhandled rejection (e.g. a
// crash in the SDK subprocess wiring or the translator sidecar) would otherwise
// exit the process silently — the bot then sees no "done"/"error" event and
// reports the opaque "agent stopped unexpectedly". Emit a redacted error first so
// the failure is always attributable, then tear down and flush.
process.on("uncaughtException", (err: unknown) => {
	const m = err instanceof Error ? (err.stack ?? err.message) : String(err);
	emit({ type: "error", message: redactSecrets(`uncaught exception: ${m}`) });
	void closeTranslator().finally(() => flushAndExit(1));
});
process.on("unhandledRejection", (reason: unknown) => {
	const m = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
	emit({ type: "error", message: redactSecrets(`unhandled rejection: ${m}`) });
	void closeTranslator().finally(() => flushAndExit(1));
});

main()
	.then(() => flushAndExit(0))
	.catch((err: unknown) => {
		const raw = err instanceof Error ? err.message : String(err);
		emit({ type: "error", message: redactSecrets(raw) });
		void closeTranslator().finally(() => flushAndExit(1));
	});
