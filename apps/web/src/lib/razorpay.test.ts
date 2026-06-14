import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  currencyFor,
  resolveCurrency,
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
