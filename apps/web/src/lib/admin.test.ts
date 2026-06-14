import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: () => getUser() } }),
}));

import { AdminForbidden, isAdminEmail, isAdminRequest, requireAdmin } from "./admin";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.ADMIN_EMAILS;
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

describe("isAdminEmail", () => {
  it("matches the allowlist case-insensitively", () => {
    process.env.ADMIN_EMAILS = "Ops@x.com, boss@x.com";
    expect(isAdminEmail("ops@x.com")).toBe(true);
    expect(isAdminEmail("BOSS@x.com")).toBe(true);
    expect(isAdminEmail("nope@x.com")).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
  it("is fail-closed when the allowlist is empty", () => {
    expect(isAdminEmail("anyone@x.com")).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("accepts the bearer token (actor cli)", async () => {
    process.env.ADMIN_API_SECRET = "s3cret";
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireAdmin(bearer("s3cret"))).resolves.toEqual({
      actorId: "cli",
    });
  });

  it("accepts an allowlisted Supabase user", async () => {
    process.env.ADMIN_EMAILS = "ops@x.com";
    getUser.mockResolvedValue({ data: { user: { email: "ops@x.com" } } });
    await expect(requireAdmin()).resolves.toEqual({ actorId: "ops@x.com" });
  });

  it("throws AdminForbidden for a non-allowlisted user", async () => {
    process.env.ADMIN_EMAILS = "ops@x.com";
    getUser.mockResolvedValue({ data: { user: { email: "intruder@x.com" } } });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminForbidden);
  });

  it("throws AdminForbidden when nobody is signed in", async () => {
    process.env.ADMIN_EMAILS = "ops@x.com";
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminForbidden);
  });
});
