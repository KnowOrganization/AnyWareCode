import { describe, expect, it } from "vitest";
import { redactSecrets, registerSecret } from "./io.js";

// Each test uses a fresh module state isn't possible with static imports,
// so we test the functions directly — secrets accumulate across tests.
// The tests are ordered to be additive.

describe("redactSecrets", () => {
  it("strips x-access-token from git URLs", () => {
    const msg = "fatal: https://x-access-token:ghs_abc123@github.com/owner/repo";
    expect(redactSecrets(msg)).toBe(
      "fatal: https://***@github.com/owner/repo",
    );
  });

  it("replaces registered secrets", () => {
    registerSecret("supersecrettoken");
    expect(redactSecrets("error: supersecrettoken was rejected")).toBe(
      "error: *** was rejected",
    );
  });

  it("replaces sk-ant-* API key patterns", () => {
    const msg = "auth failed with key sk-ant-api-AbCdEfGhIjKlMnOpQr";
    expect(redactSecrets(msg)).toMatch(/sk-ant-\*\*\*/);
    expect(redactSecrets(msg)).not.toMatch(/sk-ant-api-/);
  });

  it("handles a message with no secrets unchanged", () => {
    const msg = "rate_limit_exceeded: try again later";
    expect(redactSecrets(msg)).toBe(msg);
  });
});
