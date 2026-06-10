import { describe, expect, it } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  isAuthError,
} from "./credentials.js";

const SECRET = "a-very-secret-key-that-is-at-least-32-chars!!";
const GUILD = "123456789012345678";

describe("encrypt / decrypt", () => {
  it("round-trips plaintext", () => {
    const blob = encryptCredential(SECRET, GUILD, "sk-ant-api-token");
    expect(decryptCredential(SECRET, GUILD, blob)).toBe("sk-ant-api-token");
  });

  it("returns null for a tampered ciphertext byte", () => {
    const blob = encryptCredential(SECRET, GUILD, "token");
    const parts = blob.split(".");
    // Flip the last char of the ciphertext part
    const ct = parts[2]!;
    parts[2] = ct.slice(0, -1) + (ct.at(-1) === "a" ? "b" : "a");
    expect(decryptCredential(SECRET, GUILD, parts.join("."))).toBeNull();
  });

  it("returns null when AAD (guildId) differs — prevents cross-guild blob copy", () => {
    const blob = encryptCredential(SECRET, GUILD, "token");
    expect(decryptCredential(SECRET, "different-guild", blob)).toBeNull();
  });

  it("returns null with a rotated CREDENTIAL_SECRET", () => {
    const blob = encryptCredential(SECRET, GUILD, "token");
    expect(
      decryptCredential("different-secret-also-at-least-32-chars!", GUILD, blob),
    ).toBeNull();
  });

  it("returns null for malformed blobs", () => {
    expect(decryptCredential(SECRET, GUILD, "garbage")).toBeNull();
    expect(decryptCredential(SECRET, GUILD, "v1.only.two")).toBeNull();
    expect(decryptCredential(SECRET, GUILD, "v2.a.b.c")).toBeNull();
    expect(decryptCredential(SECRET, GUILD, "")).toBeNull();
  });
});

describe("isAuthError", () => {
  it("matches 401/403 strings", () => {
    expect(isAuthError("status 401 Unauthorized")).toBe(true);
    expect(isAuthError("403 Forbidden")).toBe(true);
  });

  it("matches authentication_error / invalid key patterns", () => {
    expect(isAuthError("authentication_error: invalid api key")).toBe(true);
    expect(isAuthError("Invalid token provided")).toBe(true);
    expect(isAuthError("invalid key detected")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(isAuthError("rate_limit_exceeded")).toBe(false);
    expect(isAuthError("network timeout")).toBe(false);
    expect(isAuthError("")).toBe(false);
  });
});
