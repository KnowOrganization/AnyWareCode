import { describe, expect, it } from "vitest";
import { sdkMessageToEvents } from "./agent.js";

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
