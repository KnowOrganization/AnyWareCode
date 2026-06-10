import { describe, expect, it } from "vitest";
import { signState, verifyState } from "./state.js";

const SECRET = "test-secret-of-decent-length";

describe("install state signing", () => {
  it("round-trips a guild id", () => {
    const state = signState(SECRET, "123456789012345678");
    expect(verifyState(SECRET, state)).toBe("123456789012345678");
  });

  it("rejects a tampered payload", () => {
    const state = signState(SECRET, "123");
    const [, sig] = state.split(".");
    const forged = `${Buffer.from("999").toString("base64url")}.${sig}`;
    expect(verifyState(SECRET, forged)).toBeNull();
  });

  it("rejects the wrong secret and malformed input", () => {
    const state = signState(SECRET, "123");
    expect(verifyState("another-secret-of-decent-len", state)).toBeNull();
    expect(verifyState(SECRET, "garbage")).toBeNull();
    expect(verifyState(SECRET, "")).toBeNull();
  });
});
