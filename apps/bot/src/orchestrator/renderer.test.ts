import { describe, expect, it } from "vitest";
import { ProgressRenderer, renderEventLine } from "./renderer.js";

describe("renderEventLine", () => {
  it("formats progress events", () => {
    expect(
      renderEventLine({ type: "edit_file", file: "src/a.ts" }),
    ).toBe("✏️ Editing src/a.ts");
    expect(
      renderEventLine({ type: "pushed", branch: "anywherecode/x" }),
    ).toBe("🔀 Pushed `anywherecode/x`");
  });

  it("excludes assistant text and done from the progress stream", () => {
    expect(renderEventLine({ type: "assistant_text", text: "hi" })).toBeNull();
    expect(renderEventLine({ type: "done" })).toBeNull();
  });

  it("neutralizes backticks in bash commands", () => {
    const line = renderEventLine({ type: "bash", command: "echo `whoami`" });
    expect(line).toBe("💻 `echo 'whoami'`");
  });
});

describe("ProgressRenderer", () => {
  it("collapses consecutive reads and keeps a rolling window", () => {
    const renderer = new ProgressRenderer();
    renderer.add({ type: "read_files", files: ["a.ts"] });
    renderer.add({ type: "read_files", files: ["b.ts"] });
    expect(renderer.render()).toBe("📂 Reading b.ts");

    for (let i = 0; i < 40; i++) {
      renderer.add({ type: "edit_file", file: `f${i}.ts` });
    }
    const lines = renderer.render().split("\n");
    expect(lines.length).toBeLessThanOrEqual(14);
    expect(lines.at(-1)).toBe("✏️ Editing f39.ts");
  });

  it("renders a placeholder before any events", () => {
    expect(new ProgressRenderer().render()).toBe("🧠 Starting…");
  });

  it("spectate mode keeps the full read stream and a bigger window", () => {
    const renderer = new ProgressRenderer();
    renderer.enableVerbose();
    renderer.add({ type: "read_files", files: ["a.ts"] });
    renderer.add({ type: "read_files", files: ["b.ts"] });
    expect(renderer.render().split("\n")).toEqual([
      "📂 Reading a.ts",
      "📂 Reading b.ts",
    ]);

    for (let i = 0; i < 40; i++) {
      renderer.add({ type: "edit_file", file: `f${i}.ts` });
    }
    expect(renderer.render().split("\n").length).toBeLessThanOrEqual(30);
    expect(renderer.render().split("\n").length).toBeGreaterThan(14);
  });
});
