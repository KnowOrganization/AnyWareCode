import { describe, expect, it } from "vitest";
import {
  llmAuthSchema,
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
    {
      type: "diff_summary",
      files: [{ path: "src/a.ts", additions: 12, deletions: 3 }],
    },
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

describe("llmAuth schema", () => {
  it("parses anthropic_api_key variant", () => {
    const auth = llmAuthSchema.parse({
      type: "anthropic_api_key",
      token: "sk-ant-api-xxx",
    });
    expect(auth.type).toBe("anthropic_api_key");
    expect(auth.token).toBe("sk-ant-api-xxx");
  });

  it("parses claude_oauth variant", () => {
    const auth = llmAuthSchema.parse({
      type: "claude_oauth",
      token: "sk-ant-oat-xxx",
    });
    expect(auth.type).toBe("claude_oauth");
  });

  it("parses custom variant with baseUrl and model", () => {
    const auth = llmAuthSchema.parse({
      type: "custom",
      token: "my-key",
      baseUrl: "https://api.example.com",
      model: "deepseek-coder",
    });
    expect(auth.type).toBe("custom");
    if (auth.type === "custom") {
      expect(auth.baseUrl).toBe("https://api.example.com");
      expect(auth.model).toBe("deepseek-coder");
    }
  });

  it("rejects unknown type", () => {
    expect(() => llmAuthSchema.parse({ type: "bedrock", token: "x" })).toThrow();
  });

  it("rejects custom with invalid baseUrl", () => {
    expect(() =>
      llmAuthSchema.parse({
        type: "custom",
        token: "x",
        baseUrl: "not-a-url",
        model: "model",
      }),
    ).toThrow();
  });

  it("rejects missing token", () => {
    expect(() =>
      llmAuthSchema.parse({ type: "anthropic_api_key" }),
    ).toThrow();
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
    llmAuth: { type: "anthropic_api_key" as const, token: "sk-ant-key" },
  };

  it("applies defaults and validates repo shape", () => {
    const spec = taskSpecSchema.parse(base);
    expect(spec.transcript).toEqual([]);
    expect(spec.resumeBranch).toBe(false);
    expect(spec.memory).toBeUndefined();
    expect(() =>
      taskSpecSchema.parse({ ...spec, repo: "not-a-repo" }),
    ).toThrow();
  });

  it("accepts MCP servers and provenance trailers, defaulting both", () => {
    const bare = taskSpecSchema.parse(base);
    expect(bare.mcpServers).toEqual([]);
    expect(bare.provenance).toBeUndefined();
    const spec = taskSpecSchema.parse({
      ...base,
      mcpServers: [
        {
          name: "sentry",
          type: "http",
          url: "https://mcp.sentry.dev/mcp",
          headers: { authorization: "Bearer x" },
        },
      ],
      provenance: { trailers: ["Initiated-by: discord:mo"] },
    });
    expect(spec.mcpServers[0]?.name).toBe("sentry");
    expect(spec.provenance?.trailers).toHaveLength(1);
    expect(() =>
      taskSpecSchema.parse({
        ...base,
        mcpServers: [{ name: "Bad Name!", type: "http", url: "https://x.dev" }],
      }),
    ).toThrow();
  });

  it("accepts a memory doc and strips unknown fields (old-runner safety)", () => {
    const spec = taskSpecSchema.parse({
      ...base,
      memory: "we use pnpm, never npm",
      someFutureField: true,
    });
    expect(spec.memory).toBe("we use pnpm, never npm");
    expect("someFutureField" in spec).toBe(false);
    expect(() =>
      taskSpecSchema.parse({ ...base, memory: "x".repeat(8193) }),
    ).toThrow();
  });

  it("requires credentials (they ride the spec, not env)", () => {
    const { githubToken, llmAuth, ...withoutCreds } = base;
    void githubToken;
    void llmAuth;
    expect(() => taskSpecSchema.parse(withoutCreds)).toThrow();
  });

  it("namespaces task branches", () => {
    expect(taskBranchName("abc123")).toBe("anywherecode/abc123");
  });
});
