import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({
  requireAdmin: () => requireAdmin(),
  AdminForbidden: class AdminForbidden extends Error {},
}));
vi.mock("@/lib/db", () => ({ db: {} }));

const getGuild = vi.fn();
const getPlan = vi.fn();
const adminSetGuildBilling = vi.fn();
const writeAudit = vi.fn();
vi.mock("@anywarecode/db", () => ({
  getGuild: (...a: unknown[]) => getGuild(...a),
  getPlan: (...a: unknown[]) => getPlan(...a),
  adminSetGuildBilling: (...a: unknown[]) => adminSetGuildBilling(...a),
  writeAudit: (...a: unknown[]) => writeAudit(...a),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("https://x/api/admin/guilds/g1/tier", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ actorId: "admin1" });
  getGuild.mockResolvedValue({
    id: "g1",
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    planId: "free",
    subStatus: "free",
  });
});

describe("POST /api/admin/guilds/[id]/tier", () => {
  it("sets the tier with subSource=admin + mirrored cap", async () => {
    getPlan.mockResolvedValue({ id: "pro", taskCap: 100, concurrency: 2 });
    const res = await POST(req({ guildId: "g1", planId: "pro" }));
    expect(res.status).toBe(200);
    expect(adminSetGuildBilling).toHaveBeenCalledWith(
      expect.anything(),
      "g1",
      expect.objectContaining({
        planId: "pro",
        subStatus: "active",
        taskCap: 100,
        concurrency: 2,
      }),
    );
    expect(writeAudit).toHaveBeenCalled();
  });

  it("403s for a non-admin", async () => {
    const { AdminForbidden } = await import("@/lib/admin");
    requireAdmin.mockRejectedValue(new AdminForbidden());
    const res = await POST(req({ guildId: "g1", planId: "pro" }));
    expect(res.status).toBe(403);
  });

  it("400s for an unknown plan", async () => {
    getPlan.mockResolvedValue(null);
    const res = await POST(req({ guildId: "g1", planId: "ghost" }));
    expect(res.status).toBe(400);
  });

  it("404s for a missing guild", async () => {
    getGuild.mockResolvedValue(null);
    const res = await POST(req({ guildId: "g1", planId: "pro" }));
    expect(res.status).toBe(404);
  });

  it("409s on an optimistic-concurrency mismatch", async () => {
    const res = await POST(
      req({ guildId: "g1", planId: "pro", expectedUpdatedAt: "stale" }),
    );
    expect(res.status).toBe(409);
  });
});
