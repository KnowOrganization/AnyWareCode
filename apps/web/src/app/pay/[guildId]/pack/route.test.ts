import { describe, expect, it, vi, beforeEach } from "vitest";

const getGuild = vi.fn();
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@anywarecode/db", () => ({
  getGuild: (...a: unknown[]) => getGuild(...a),
}));

const createPackUrl = vi.fn();
const verifyPackToken = vi.fn();
vi.mock("@/lib/razorpay", () => ({
  createPackUrl: (...a: unknown[]) => createPackUrl(...a),
  verifyPackToken: (...a: unknown[]) => verifyPackToken(...a),
  currencyFor: () => "INR",
  resolveCurrency: (_o: unknown, f: string) => f,
}));

import { GET } from "./route";

function req(token?: string): Request {
  const u = new URL("https://x/pay/g1/pack");
  if (token) u.searchParams.set("t", token);
  return new Request(u);
}
const params = Promise.resolve({ guildId: "g1" });

beforeEach(() => {
  vi.clearAllMocks();
  getGuild.mockResolvedValue({ id: "g1" });
  createPackUrl.mockResolvedValue("https://rzp.test/plink");
  verifyPackToken.mockReturnValue(null);
});

describe("GET /pay/[guildId]/pack", () => {
  it("redirects unattributed when there is no token", async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://rzp.test/plink");
    expect(createPackUrl).toHaveBeenCalledWith({ guildId: "g1", currency: "INR" });
  });

  it("attributes the buyer when the signed token matches the guild", async () => {
    verifyPackToken.mockReturnValue({ g: "g1", u: "u9", n: "maya", e: 9e15 });
    const res = await GET(req("tok"), { params });
    expect(res.status).toBe(303);
    expect(createPackUrl).toHaveBeenCalledWith({
      guildId: "g1",
      currency: "INR",
      buyerId: "u9",
      buyerName: "maya",
    });
  });

  it("ignores a token signed for a different guild", async () => {
    verifyPackToken.mockReturnValue({ g: "other", u: "u9", n: "maya", e: 9e15 });
    await GET(req("tok"), { params });
    expect(createPackUrl).toHaveBeenCalledWith({ guildId: "g1", currency: "INR" });
  });

  it("404s when the bot isn't installed", async () => {
    getGuild.mockResolvedValue(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });
});
