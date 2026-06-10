import { describe, expect, it } from "vitest";
import {
  parseRunnerEvent,
  serializeEvent,
  taskBranchName,
  taskSpecSchema,
  type RunnerEvent,
} from "./index.js";

describe("runner event protocol", () => {
  const samples: RunnerEvent[] = [
    { type: "plan", text: "read auth, then patch middleware" },
    { type: "read_files", files: ["src/auth/middleware.ts"] },
    { type: "edit_file", file: "src/auth/middleware.ts" },
    { type: "bash", command: "pnpm test" },
    { type: "tests", passed: true, summary: "12/12" },
    { type: "assistant_text", text: "Done, opening a PR." },
    { type: "pushed", branch: "anywherecode/abc123" },
    { type: "error", message: "boom" },
    { type: "done", summary: "patched" },
  ];

  it.each(samples)("round-trips $type", (event) => {
    expect(parseRunnerEvent(serializeEvent(event))).toEqual(event);
  });

  it("ignores non-protocol output", () => {
    expect(parseRunnerEvent("npm WARN deprecated")).toBeNull();
    expect(parseRunnerEvent("{not json")).toBeNull();
    expect(parseRunnerEvent('{"type":"unknown"}')).toBeNull();
    expect(parseRunnerEvent("")).toBeNull();
  });
});

describe("task spec", () => {
  const base = {
    taskId: "abc",
    repo: "owner/repo",
    branch: "anywherecode/abc",
    baseBranch: "main",
    prompt: "do things",
    mode: "code" as const,
    githubToken: "ghs_token",
    anthropicApiKey: "sk-ant-key",
  };

  it("applies defaults and validates repo shape", () => {
    const spec = taskSpecSchema.parse(base);
    expect(spec.transcript).toEqual([]);
    expect(spec.resumeBranch).toBe(false);
    expect(() =>
      taskSpecSchema.parse({ ...spec, repo: "not-a-repo" }),
    ).toThrow();
  });

  it("requires credentials (they ride the spec, not env)", () => {
    const { githubToken, anthropicApiKey, ...withoutCreds } = base;
    void githubToken;
    void anthropicApiKey;
    expect(() => taskSpecSchema.parse(withoutCreds)).toThrow();
  });

  it("namespaces task branches", () => {
    expect(taskBranchName("abc123")).toBe("anywherecode/abc123");
  });
});
