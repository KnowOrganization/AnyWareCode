import { createHmac } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import {
  currencyFor,
  resolveCurrency,
  verifyPackToken,
  verifyWebhookSignature,
} from "./razorpay";

const SECRET = "whsec_test";
const sign = (body: string) =>
  createHmac("sha256", SECRET).update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  it("accepts a correct HMAC-SHA256 of the raw body", () => {
    const body = '{"event":"subscription.charged"}';
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = '{"event":"subscription.charged"}';
    const sig = sign(body);
    expect(verifyWebhookSignature(body + " ", sig, SECRET)).toBe(false);
  });

  it("rejects a wrong signature", () => {
    const body = "{}";
    expect(verifyWebhookSignature(body, "deadbeef", SECRET)).toBe(false);
  });
});

describe("currency detection", () => {
  it("returns INR for India, USD otherwise", () => {
    const inReq = new Request("https://x", {
      headers: { "x-vercel-ip-country": "IN" },
    });
    const usReq = new Request("https://x", {
      headers: { "x-vercel-ip-country": "US" },
    });
    expect(currencyFor(inReq)).toBe("INR");
    expect(currencyFor(usReq)).toBe("USD");
    expect(currencyFor(new Request("https://x"))).toBe("USD");
  });

  it("honors a valid override else falls back", () => {
    expect(resolveCurrency("INR", "USD")).toBe("INR");
    expect(resolveCurrency("bogus", "USD")).toBe("USD");
    expect(resolveCurrency(undefined, "INR")).toBe("INR");
  });
});

describe("verifyPackToken (bot↔web pack attribution)", () => {
  const PACK_SECRET = "p".repeat(24);
  // Mirrors the bot's signPackToken: base64url(JSON) + "." + HMAC-SHA256 hex.
  const mint = (payload: object, secret = PACK_SECRET) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    return `${body}.${createHmac("sha256", secret).update(body).digest("hex")}`;
  };

  beforeEach(() => {
    process.env.BILLING_BRIDGE_SECRET = PACK_SECRET;
  });

  it("accepts a correctly signed, unexpired token", () => {
    const claim = { g: "g1", u: "u9", n: "maya", e: Date.now() + 60_000 };
    expect(verifyPackToken(mint(claim))).toEqual(claim);
  });

  it("rejects a token signed with the wrong secret", () => {
    const claim = { g: "g1", u: "u9", n: "maya", e: Date.now() + 60_000 };
    expect(verifyPackToken(mint(claim, "wrong-secret-aaaaaaaaaaaa"))).toBeNull();
  });

  it("rejects an expired token", () => {
    const claim = { g: "g1", u: "u9", n: "maya", e: Date.now() - 1 };
    expect(verifyPackToken(mint(claim))).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyPackToken("garbage")).toBeNull();
  });
});
