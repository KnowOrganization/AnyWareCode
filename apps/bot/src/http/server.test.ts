import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import type { GitHubService } from "../github/app.js";
import { buildServer, type ServerDeps } from "./server.js";

function makeDeps(opts: {
  duplicate?: boolean;
  badSignature?: boolean;
}): { deps: ServerDeps; verify: ReturnType<typeof vi.fn> } {
  const verify = vi.fn(async () => {
    if (opts.badSignature) throw new Error("signature mismatch");
  });
  const insertChain = {
    values: () => ({
      onConflictDoNothing: () => ({
        returning: async () => (opts.duplicate ? [] : [{ id: "d1" }]),
      }),
    }),
  };
  const deps: ServerDeps = {
    db: { insert: () => insertChain } as unknown as ServerDeps["db"],
    config: { GITHUB_WEBHOOK_SECRET: "shhh-very-secret" } as Config,
    github: { webhooks: { verifyAndReceive: verify } } as unknown as GitHubService,
    onInstallationLinked: async () => {},
    isDiscordReady: () => true,
    pingDocker: async () => true,
  };
  return { deps, verify };
}

const HEADERS = {
  "content-type": "application/json",
  "x-github-delivery": "d1",
  "x-github-event": "issues",
  "x-hub-signature-256": "sha256=abc",
};

describe("POST /github/webhook", () => {
  it("rejects deliveries missing webhook headers", async () => {
    const { deps } = makeDeps({});
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/github/webhook",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(400);
  });

  it("verifies the signature and acks", async () => {
    const { deps, verify } = makeDeps({});
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/github/webhook",
      headers: HEADERS,
      payload: '{"action":"opened"}',
    });
    expect(res.statusCode).toBe(200);
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "d1",
        name: "issues",
        signature: "sha256=abc",
        payload: '{"action":"opened"}',
      }),
    );
  });

  it("401s on a bad signature", async () => {
    const { deps } = makeDeps({ badSignature: true });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/github/webhook",
      headers: HEADERS,
      payload: "{}",
    });
    expect(res.statusCode).toBe(401);
  });

  it("acks replayed deliveries without re-processing", async () => {
    const { deps, verify } = makeDeps({ duplicate: true });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/github/webhook",
      headers: HEADERS,
      payload: "{}",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ duplicate: true });
    expect(verify).not.toHaveBeenCalled();
  });

  it("is absent when no webhook secret is configured", async () => {
    const { deps } = makeDeps({});
    deps.config = {} as Config;
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/github/webhook",
      headers: HEADERS,
      payload: "{}",
    });
    expect(res.statusCode).toBe(404);
  });
});
