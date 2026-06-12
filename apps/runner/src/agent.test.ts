import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TaskSpec } from "@anywherecode/shared";
import { buildSystemAppend, detectGameEngine, sdkMessageToEvents } from "./agent.js";

function assistant(content: unknown[]): unknown {
  return { type: "assistant", message: { content } };
}

describe("sdkMessageToEvents", () => {
  it("maps tool use onto protocol events", () => {
    const events = [
      ...sdkMessageToEvents(
        assistant([
          { type: "text", text: "Let me look around." },
          { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
          { type: "tool_use", name: "Edit", input: { file_path: "a.ts" } },
          { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
        ]),
      ),
    ];
    expect(events).toEqual([
      { type: "assistant_text", text: "Let me look around." },
      { type: "read_files", files: ["a.ts"] },
      { type: "edit_file", file: "a.ts" },
      { type: "bash", command: "pnpm test" },
    ]);
  });

  it("turns todo lists into plan events", () => {
    const events = [
      ...sdkMessageToEvents(
        assistant([
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [{ content: "read" }, { content: "patch" }] },
          },
        ]),
      ),
    ];
    expect(events).toEqual([{ type: "plan", text: "read → patch" }]);
  });

  it("maps the result message to done", () => {
    const events = [
      ...sdkMessageToEvents({ type: "result", result: "all set" }),
    ];
    expect(events).toEqual([{ type: "done", summary: "all set" }]);
  });

  it("ignores system noise", () => {
    expect([...sdkMessageToEvents({ type: "system", subtype: "init" })]).toEqual(
      [],
    );
  });
});

function specWith(overrides: Partial<TaskSpec>): TaskSpec {
  return {
    taskId: "t",
    repo: "o/r",
    branch: "anywherecode/t",
    baseBranch: "main",
    prompt: "do it",
    mode: "code",
    transcript: [],
    resumeBranch: false,
    githubToken: "gh",
    llmAuth: { type: "anthropic_api_key", token: "sk" },
    ...overrides,
  };
}

describe("buildSystemAppend", () => {
  it("frames server memory after the hardening rules", () => {
    const out = buildSystemAppend(
      specWith({ memory: "we use pnpm, never npm" }),
      mkdtempSync(path.join(tmpdir(), "aw-")),
    );
    expect(out.indexOf("untrusted data")).toBeLessThan(
      out.indexOf("Server conventions"),
    );
    expect(out).toContain("we use pnpm, never npm");
    expect(out).toContain("do NOT override the safety rules");
  });

  it("omits the memory section when none is set", () => {
    const out = buildSystemAppend(
      specWith({}),
      mkdtempSync(path.join(tmpdir(), "aw-")),
    );
    expect(out).not.toContain("Server conventions");
  });

  it("adds the game prompt for engine projects", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aw-"));
    writeFileSync(path.join(dir, "project.godot"), "");
    expect(detectGameEngine(dir)).toBe(true);
    expect(buildSystemAppend(specWith({}), dir)).toContain("game project");
  });

  it("keeps the ask prompt in ask mode", () => {
    const out = buildSystemAppend(
      specWith({ mode: "ask" }),
      mkdtempSync(path.join(tmpdir(), "aw-")),
    );
    expect(out).toContain("read-only access");
  });
});
