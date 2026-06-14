import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { budgetForVerify, buildRepairPrompt, detectChecks } from "./verify.js";
import { createTaskSpec as spec } from "./test-fixtures.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "aw-verify-"));
}

function withNodeModules(dir: string): void {
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
}

function pkg(dir: string, scripts: Record<string, string>): void {
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts }));
}

describe("detectChecks", () => {
  it("detects allowlisted package.json scripts in run order", () => {
    const dir = tmp();
    withNodeModules(dir);
    pkg(dir, { test: "vitest", typecheck: "tsc", build: "tsc -b" });
    const result = detectChecks(dir, spec());
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      // typecheck before test; build is not in the allowlist.
      expect(result.checks.map((c) => c.name)).toEqual(["typecheck", "test"]);
      expect(result.checks[0]?.cmd).toContain("typecheck");
    }
  });

  it("skips when dependencies aren't installed (prod egress guard)", () => {
    const dir = tmp();
    pkg(dir, { test: "vitest" });
    const result = detectChecks(dir, spec());
    expect(result.skipped).toBe(true);
    if (result.skipped) expect(result.reason).toMatch(/dependencies/);
  });

  it("skips game projects", () => {
    const dir = tmp();
    withNodeModules(dir);
    writeFileSync(path.join(dir, "project.godot"), "");
    expect(detectChecks(dir, spec()).skipped).toBe(true);
  });

  it("falls back to tsc --noEmit when tsconfig and the binary exist", () => {
    const dir = tmp();
    withNodeModules(dir);
    mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", ".bin", "tsc"), "");
    writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    pkg(dir, {}); // no typecheck script
    const result = detectChecks(dir, spec());
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0]?.name).toBe("typecheck");
      expect(result.checks[0]?.cmd).toContain("--noEmit");
    }
  });

  it("honors an explicit allowlist-validated override", () => {
    const dir = tmp();
    const result = detectChecks(
      dir,
      spec({ verify: { enabled: true, maxRepairAttempts: 0, commands: [{ name: "test", run: "test" }] } }),
    );
    expect(result.skipped).toBe(false);
    if (!result.skipped) expect(result.checks[0]?.name).toBe("test");
  });
});

describe("budgetForVerify", () => {
  it("reserves a push floor and caps per-check time", () => {
    const now = 0;
    const b = budgetForVerify(20 * 60_000, now);
    expect(b.canRun).toBe(true);
    expect(b.perCheckTimeoutMs).toBe(5 * 60_000); // hard cap
  });

  it("refuses to start with too little runway", () => {
    expect(budgetForVerify(60_000, 0).canRun).toBe(false);
  });
});

describe("buildRepairPrompt", () => {
  it("frames the failures and forbids git, echoing no secrets", () => {
    const out = buildRepairPrompt("add a feature", [
      { name: "typecheck", passed: false, summary: "3 errors", output: "TS2322 ..." },
    ]);
    expect(out).toContain("Failing check: typecheck");
    expect(out).toContain("TS2322");
    expect(out).toContain("Do not run any git");
    expect(out).toContain("add a feature");
  });
});
