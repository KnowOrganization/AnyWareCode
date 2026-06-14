import { describe, expect, it, vi, beforeEach } from "vitest";

const getGuild = vi.fn();
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@anywarecode/db", () => ({
  getGuild: (...a: unknown[]) => getGuild(...a),
}));

const createSubscriptionUrl = vi.fn();
vi.mock("@/lib/razorpay", () => ({
  createSubscriptionUrl: (...a: unknown[]) => createSubscriptionUrl(...a),
  currencyFor: () => "USD",
  resolveCurrency: (_o: unknown, f: string) => f,
}));

import { GET } from "./route";

function req(plan?: string): Request {
  const u = new URL("https://x/pay/g1/sub");
  if (plan) u.searchParams.set("plan", plan);
  return new Request(u);
}
const params = Promise.resolve({ guildId: "g1" });

beforeEach(() => {
  vi.clearAllMocks();
  getGuild.mockResolvedValue({ id: "g1" });
  createSubscriptionUrl.mockResolvedValue("https://rzp.test/sub_abc");
});

describe("GET /pay/[guildId]/sub", () => {
  it("redirects to the Razorpay subscription url", async () => {
    const res = await GET(req("pro"), { params });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://rzp.test/sub_abc");
    expect(createSubscriptionUrl).toHaveBeenCalledWith("g1", "pro", "USD");
  });

  it("400s on an unknown plan", async () => {
    const res = await GET(req("enterprise"), { params });
    expect(res.status).toBe(400);
    expect(createSubscriptionUrl).not.toHaveBeenCalled();
  });

  it("404s when the bot isn't installed", async () => {
    getGuild.mockResolvedValue(null);
    const res = await GET(req("studio"), { params });
    expect(res.status).toBe(404);
  });

  it("502s when checkout creation fails", async () => {
    createSubscriptionUrl.mockRejectedValue(new Error("Plan not configured"));
    const res = await GET(req("pro"), { params });
    expect(res.status).toBe(502);
  });
});
