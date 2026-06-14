import { describe, expect, it, vi, beforeEach } from "vitest";

const verify = vi.fn();
vi.mock("@/lib/razorpay", () => ({
  verifyWebhookSignature: (...a: unknown[]) => verify(...a),
  PACK_TASKS: 50,
}));

const applyGuildSubscription = vi.fn();
const recordTaskPackPurchase = vi.fn();
const findPlanByRazorpayPlanId = vi.fn();
const findGuildByRazorpayCustomer = vi.fn();
let dedupRows: { id: string }[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(dedupRows),
        }),
      }),
    }),
  },
}));
vi.mock("@anywherecode/db", () => ({
  applyGuildSubscription: (...a: unknown[]) => applyGuildSubscription(...a),
  recordTaskPackPurchase: (...a: unknown[]) => recordTaskPackPurchase(...a),
  findPlanByRazorpayPlanId: (...a: unknown[]) => findPlanByRazorpayPlanId(...a),
  findGuildByRazorpayCustomer: (...a: unknown[]) =>
    findGuildByRazorpayCustomer(...a),
  schema: { razorpayWebhookEvents: { eventId: "event_id" } },
}));

import { POST } from "./route";

function req(body: unknown, sig = "sig", eventId = "evt_1"): Request {
  return new Request("https://x/api/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": eventId },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dedupRows = [{ id: "evt_1" }]; // default: a fresh event
  verify.mockReturnValue(true);
  process.env.RAZORPAY_WEBHOOK_SECRET = "whsec";
});

describe("POST /api/razorpay/webhook", () => {
  it("400s on a bad signature", async () => {
    verify.mockReturnValue(false);
    const res = await POST(req({ event: "subscription.charged" }));
    expect(res.status).toBe(400);
    expect(applyGuildSubscription).not.toHaveBeenCalled();
  });

  it("acks a duplicate event without processing", async () => {
    dedupRows = []; // insert conflicted → already seen
    const res = await POST(req({ event: "subscription.charged" }));
    expect(await res.json()).toEqual({ duplicate: true });
    expect(applyGuildSubscription).not.toHaveBeenCalled();
  });

  it("activates a subscription onto the guild via the choke point", async () => {
    findPlanByRazorpayPlanId.mockResolvedValue({
      id: "pro",
      taskCap: 100,
      concurrency: 2,
    });
    const res = await POST(
      req({
        event: "subscription.activated",
        payload: {
          subscription: {
            entity: {
              id: "sub_1",
              plan_id: "plan_pro_usd",
              status: "active",
              current_end: 1893456000,
              notes: { guildId: "g1" },
            },
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(applyGuildSubscription).toHaveBeenCalledWith(
      expect.anything(),
      "g1",
      expect.objectContaining({
        subStatus: "active",
        subSource: "razorpay",
        planId: "pro",
        taskCap: 100,
        concurrency: 2,
      }),
      expect.objectContaining({ onlyIfSource: ["razorpay", null] }),
    );
  });

  it("credits a pack on payment_link.paid", async () => {
    const res = await POST(
      req({
        event: "payment_link.paid",
        payload: {
          payment_link: {
            entity: {
              id: "plink_1",
              amount: 1000,
              notes: { kind: "task_pack", guildId: "g1", purchasedBy: "u1" },
            },
          },
          payment: { entity: { id: "pay_1", amount: 1000 } },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(recordTaskPackPurchase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        guildId: "g1",
        tasks: 50,
        razorpayPaymentId: "pay_1",
      }),
    );
  });

  it("cancels with the admin/discord source guard", async () => {
    const res = await POST(
      req({
        event: "subscription.cancelled",
        payload: {
          subscription: { entity: { id: "sub_1", notes: { guildId: "g1" } } },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(applyGuildSubscription).toHaveBeenCalledWith(
      expect.anything(),
      "g1",
      expect.objectContaining({ subStatus: "canceled" }),
      expect.objectContaining({ onlyIfSource: ["razorpay", null] }),
    );
  });
});
