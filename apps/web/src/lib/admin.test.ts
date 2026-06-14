import { afterEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

import {
  AdminForbidden,
  isAdminDiscordId,
  isAdminRequest,
  requireAdmin,
} from "./admin";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.ADMIN_DISCORD_IDS;
});

function bearer(token: string): Request {
  return new Request("https://x", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("isAdminRequest", () => {
  it("denies when the secret is unset", () => {
    expect(isAdminRequest(bearer("anything"))).toBe(false);
  });
  it("accepts the matching token, rejects others", () => {
    process.env.ADMIN_API_SECRET = "s3cret";
    expect(isAdminRequest(bearer("s3cret"))).toBe(true);
    expect(isAdminRequest(bearer("nope"))).toBe(false);
    expect(isAdminRequest(new Request("https://x"))).toBe(false);
  });
});

describe("isAdminDiscordId", () => {
  it("matches the allowlist", () => {
    process.env.ADMIN_DISCORD_IDS = "111, 222";
    expect(isAdminDiscordId("111")).toBe(true);
    expect(isAdminDiscordId("222")).toBe(true);
    expect(isAdminDiscordId("333")).toBe(false);
    expect(isAdminDiscordId(undefined)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("accepts the bearer token (actor cli)", async () => {
    process.env.ADMIN_API_SECRET = "s3cret";
    authMock.mockResolvedValue(null);
    await expect(requireAdmin(bearer("s3cret"))).resolves.toEqual({
      actorId: "cli",
    });
  });

  it("accepts an allowlisted Discord session", async () => {
    process.env.ADMIN_DISCORD_IDS = "111";
    authMock.mockResolvedValue({ discordId: "111" });
    await expect(requireAdmin()).resolves.toEqual({ actorId: "111" });
  });

  it("throws AdminForbidden for a non-admin", async () => {
    process.env.ADMIN_DISCORD_IDS = "111";
    authMock.mockResolvedValue({ discordId: "999" });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminForbidden);
  });
});
