import { describe, expect, it, vi, beforeEach } from "vitest";

const getGuild = vi.fn();
const cancel = vi.fn();
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@anywarecode/db", () => ({
  getGuild: (...a: unknown[]) => getGuild(...a),
}));
vi.mock("@/lib/razorpay", () => ({
  razorpayConfigured: () => true,
  getRazorpay: () => ({ subscriptions: { cancel: (...a: unknown[]) => cancel(...a) } }),
}));

import { POST } from "./route";

function req(body: unknown, auth?: string): Request {
  return new Request("https://x/api/billing/cancel", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BILLING_BRIDGE_SECRET = "s".repeat(24);
  getGuild.mockResolvedValue({ id: "g1", razorpaySubscriptionId: "sub_1" });
});

describe("POST /api/billing/cancel", () => {
  it("401s without the bearer secret", async () => {
    const res = await POST(req({ guildId: "g1" }));
    expect(res.status).toBe(401);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("401s with a wrong bearer", async () => {
    const res = await POST(req({ guildId: "g1" }, "Bearer nope"));
    expect(res.status).toBe(401);
  });

  it("cancels at cycle end with the correct bearer", async () => {
    const res = await POST(req({ guildId: "g1" }, `Bearer ${"s".repeat(24)}`));
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("sub_1", true);
  });

  it("400s when there is no active subscription", async () => {
    getGuild.mockResolvedValue({ id: "g1", razorpaySubscriptionId: null });
    const res = await POST(req({ guildId: "g1" }, `Bearer ${"s".repeat(24)}`));
    expect(res.status).toBe(400);
  });
});
