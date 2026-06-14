import { describe, expect, it } from "vitest";
import { preflight } from "./preflight.js";
import { createTaskSpec as spec } from "./test-fixtures.js";

describe("preflight", () => {
  it("passes with exactly the matching credential env", () => {
    expect(preflight(spec(), { ANTHROPIC_API_KEY: "k" })).toEqual([]);
  });

  it("flags both first-party credentials set at once", () => {
    const problems = preflight(spec(), {
      ANTHROPIC_API_KEY: "k",
      CLAUDE_CODE_OAUTH_TOKEN: "o",
    });
    expect(problems.join(" ")).toMatch(/both ANTHROPIC_API_KEY/);
  });

  it("flags a missing credential", () => {
    expect(preflight(spec(), {})).toContain("no LLM credential is configured");
  });

  it("flags an env/auth-type mismatch", () => {
    const problems = preflight(
      spec({ llmAuth: { type: "claude_oauth", token: "o" } }),
      { ANTHROPIC_API_KEY: "k" },
    );
    expect(problems.join(" ")).toMatch(/CLAUDE_CODE_OAUTH_TOKEN is unset/);
  });

  it("validates custom auth env set", () => {
    const ok = preflight(
      spec({ llmAuth: { type: "custom", token: "t", baseUrl: "https://x.dev", model: "m" } }),
      { ANTHROPIC_BASE_URL: "https://x.dev", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_MODEL: "m" },
    );
    expect(ok).toEqual([]);
  });

  it("rejects a malformed model id", () => {
    const problems = preflight(spec({ model: "bad model!" }), {
      ANTHROPIC_API_KEY: "k",
    });
    expect(problems.join(" ")).toMatch(/malformed/);
  });

  it("rejects a non-Claude model for first-party auth", () => {
    const problems = preflight(spec({ model: "gpt-4o" }), { ANTHROPIC_API_KEY: "k" });
    expect(problems.join(" ")).toMatch(/not a Claude model/);
  });

  it("allows any model for custom providers", () => {
    const ok = preflight(
      spec({
        model: "deepseek-coder",
        llmAuth: { type: "custom", token: "t", baseUrl: "https://x.dev", model: "deepseek-coder" },
      }),
      { ANTHROPIC_BASE_URL: "https://x.dev", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_MODEL: "deepseek-coder" },
    );
    expect(ok).toEqual([]);
  });
});
