import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { TaskSpec } from "@anywarecode/shared";
import { redactSecrets } from "./io.js";
import { detectGameEngine } from "./repo.js";

const execFileAsync = promisify(execFile);

/** A single verification command the runner is willing to run. */
export interface Check {
  name: string;
  /** argv[0] + args, run via child_process (never a shell string). */
  cmd: string[];
}

export interface CheckResult {
  name: string;
  passed: boolean;
  /** Short, redacted, human line for Discord. */
  summary: string;
  /** Redacted output tail, fed back to the agent on a repair turn. */
  output: string;
}

export type Detection =
  | { skipped: true; reason: string }
  | { skipped: false; checks: Check[] };

/**
 * Script keys we are willing to run from a repo's package.json. We never run an
 * arbitrary key and never execute the script body ourselves — only `<pm> run
 * <key>` for these canonical names. Order here is the run order.
 */
const ALLOWED_SCRIPT_KEYS = ["typecheck", "lint", "test"] as const;
/** Build is intentionally excluded by default: too slow/flaky for a gate. */

function detectPackageManager(workdir: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(path.join(workdir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(workdir, "yarn.lock"))) return "yarn";
  return "npm";
}

function runVerb(pm: "pnpm" | "yarn" | "npm", key: string): string[] {
  // yarn runs scripts as `yarn <key>`; pnpm/npm as `<pm> run <key>`.
  return pm === "yarn" ? [pm, key] : [pm, "run", key];
}

function installArgs(pm: "pnpm" | "yarn" | "npm"): string[] {
  // Non-frozen: the agent may have edited package.json, so a lockfile mismatch
  // must not hard-fail the install.
  switch (pm) {
    case "pnpm":
      return ["install", "--no-frozen-lockfile"];
    case "yarn":
      return ["install"];
    default:
      return ["install", "--no-audit", "--no-fund"];
  }
}

/**
 * Best-effort dependency install so the project's checks can actually run. The
 * prod egress allowlist permits the npm/yarn registries; in dev the runner has
 * direct network. Failure (or a non-JS repo) is non-fatal — `node_modules` is
 * simply left absent, so `detectChecks` skips verification exactly as before.
 * Runs in the same hardened container that already executes untrusted repo code,
 * so install scripts add no new trust boundary. Time-boxed by the caller.
 */
export async function installDeps(
  workdir: string,
  timeoutMs: number,
): Promise<{ installed: boolean; reason?: string }> {
  if (!existsSync(path.join(workdir, "package.json"))) {
    return { installed: false, reason: "no package.json" };
  }
  if (existsSync(path.join(workdir, "node_modules"))) {
    return { installed: true }; // already vendored
  }
  const pm = detectPackageManager(workdir);
  try {
    await execFileAsync(pm, installArgs(pm), {
      cwd: workdir,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return { installed: existsSync(path.join(workdir, "node_modules")) };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      installed: false,
      reason: redactSecrets((e.stderr || e.message || "install failed").slice(-200)),
    };
  }
}

function readScripts(workdir: string): Record<string, string> | null {
  try {
    const raw = readFileSync(path.join(workdir, "package.json"), "utf8");
    const json = JSON.parse(raw) as { scripts?: Record<string, string> };
    return json.scripts ?? {};
  } catch {
    return null;
  }
}

/**
 * Decide what to verify, without trusting repo-authored command strings:
 *  1. explicit allowlisted override on the spec,
 *  2. canonical package.json script keys (run via the detected PM),
 *  3. a tsconfig.json fallback (`tsc --noEmit`) when its binary is resolvable.
 * Returns a skip when deps aren't installed (prod egress can't `npm install`)
 * or the project isn't a JS/TS one.
 */
export function detectChecks(workdir: string, spec: TaskSpec): Detection {
  if (detectGameEngine(workdir)) {
    return { skipped: true, reason: "game project — verification skipped" };
  }

  // Explicit override (already shape-validated; re-validate the name here).
  const override = spec.verify?.commands;
  if (override && override.length > 0) {
    const pm = detectPackageManager(workdir);
    const checks = override
      .filter((c) => /^[a-z0-9-]+$/.test(c.name))
      .map((c) => ({ name: c.name, cmd: runVerb(pm, c.run) }));
    if (checks.length > 0) return { skipped: false, checks };
  }

  // Everything below needs installed dependencies.
  if (!existsSync(path.join(workdir, "node_modules"))) {
    return {
      skipped: true,
      reason: "dependencies not installed — verification skipped",
    };
  }

  const scripts = readScripts(workdir);
  const checks: Check[] = [];
  if (scripts) {
    const pm = detectPackageManager(workdir);
    for (const key of ALLOWED_SCRIPT_KEYS) {
      if (typeof scripts[key] === "string" && scripts[key]!.trim()) {
        checks.push({ name: key, cmd: runVerb(pm, key) });
      }
    }
  }

  // Fallback: typecheck via the local tsc binary when there's a tsconfig and no
  // typecheck script already covering it.
  if (
    !checks.some((c) => c.name === "typecheck") &&
    existsSync(path.join(workdir, "tsconfig.json"))
  ) {
    const tsc = path.join(workdir, "node_modules", ".bin", "tsc");
    if (existsSync(tsc)) {
      checks.push({ name: "typecheck", cmd: [tsc, "--noEmit"] });
    }
  }

  if (checks.length === 0) {
    return { skipped: true, reason: "no runnable checks detected" };
  }
  return { skipped: false, checks };
}

/** Per-check hard cap regardless of remaining budget (env-overridable). */
const CHECK_HARD_CAP_MS = Number(process.env.VERIFY_CHECK_HARD_CAP_MS) || 5 * 60_000;
/** Wall-clock floor reserved for commit/push after verification. */
const PUSH_FLOOR_MS = Number(process.env.VERIFY_PUSH_FLOOR_MS) || 60_000;
/** Minimum runway before a verify pass is worth starting. */
const MIN_RUNWAY_MS = Number(process.env.VERIFY_MIN_RUNWAY_MS) || 90_000;

export interface Budget {
  canRun: boolean;
  perCheckTimeoutMs: number;
}

export function budgetForVerify(deadlineMs: number, nowMs: number): Budget {
  const remaining = deadlineMs - nowMs;
  if (remaining < MIN_RUNWAY_MS) return { canRun: false, perCheckTimeoutMs: 0 };
  return {
    canRun: true,
    perCheckTimeoutMs: Math.min(CHECK_HARD_CAP_MS, remaining - PUSH_FLOOR_MS),
  };
}

function tail(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `…${t.slice(t.length - max)}` : t;
}

export async function runCheck(
  check: Check,
  workdir: string,
  timeoutMs: number,
): Promise<CheckResult> {
  try {
    await execFileAsync(check.cmd[0]!, check.cmd.slice(1), {
      cwd: workdir,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return { name: check.name, passed: true, summary: "passed", output: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const raw = redactSecrets(
      [e.stdout, e.stderr, e.message].filter(Boolean).join("\n"),
    );
    const summary = e.killed
      ? `timed out after ${Math.round(timeoutMs / 1000)}s`
      : tail(raw.split("\n").filter(Boolean).slice(-3).join(" "), 180) || "failed";
    return {
      name: check.name,
      passed: false,
      summary,
      output: tail(raw, 4000),
    };
  }
}

export async function runChecks(
  checks: Check[],
  workdir: string,
  budget: Budget,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    results.push(await runCheck(check, workdir, budget.perCheckTimeoutMs));
  }
  return results;
}

/** Repair turn: focus the agent on the failing checks. Never echoes secrets. */
export function buildRepairPrompt(
  originalPrompt: string,
  failures: CheckResult[],
): string {
  const sections = failures.map(
    (f) => `## Failing check: ${f.name}\n${f.output || f.summary}`,
  );
  return [
    "Your previous changes did not pass the project's checks.",
    "Fix the failures below with the minimal necessary changes.",
    "Do not run any git commands; the harness handles commits.",
    "",
    ...sections,
    "",
    `Original task (for reference): ${originalPrompt}`,
    "Make the changes so every check above passes.",
  ].join("\n");
}
