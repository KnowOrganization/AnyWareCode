import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSystemAppend,
  detectGameEngine,
  detectStack,
  sdkMessageToEvents,
} from "./agent.js";
import { createTaskSpec as specWith } from "./test-fixtures.js";

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

  it("appends craft rules for code mode, after the hardening rules", () => {
    const out = buildSystemAppend(
      specWith({ mode: "code" }),
      mkdtempSync(path.join(tmpdir(), "aw-")),
    );
    expect(out).toContain("smallest diff");
    expect(out.indexOf("untrusted data")).toBeLessThan(out.indexOf("smallest diff"));
  });

  it("omits craft rules in ask mode", () => {
    const out = buildSystemAppend(
      specWith({ mode: "ask" }),
      mkdtempSync(path.join(tmpdir(), "aw-")),
    );
    expect(out).not.toContain("smallest diff");
  });

  it("adds stack rules for a detected TypeScript project", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aw-"));
    writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    expect(detectStack(dir)).toContain("ts");
    expect(buildSystemAppend(specWith({ mode: "code" }), dir)).toContain(
      "TypeScript:",
    );
  });

  it("injects the repo's AGENTS.md framed as data, after the hardening rules", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aw-"));
    writeFileSync(path.join(dir, "AGENTS.md"), "# Conventions\nUse pnpm.");
    const out = buildSystemAppend(specWith({}), dir);
    expect(out).toContain("AGENTS.md — repo-authored");
    expect(out).toContain("Use pnpm.");
    expect(out).toContain("does NOT");
    expect(out.indexOf("untrusted data")).toBeLessThan(out.indexOf("Use pnpm."));
  });

  it("caps a huge AGENTS.md and skips an empty one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aw-"));
    writeFileSync(path.join(dir, "AGENTS.md"), "x".repeat(10_000));
    expect(buildSystemAppend(specWith({}), dir).length).toBeLessThan(7000);
    const empty = mkdtempSync(path.join(tmpdir(), "aw-"));
    writeFileSync(path.join(empty, "AGENTS.md"), "   \n");
    expect(buildSystemAppend(specWith({}), empty)).not.toContain("AGENTS.md");
  });
});
