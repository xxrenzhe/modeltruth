import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStripeCheckoutSession, createStripePortalSession, verifyStripeWebhook } from "./stripe";

describe("verifyStripeWebhook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_TEAM_PRICE_ID;
  });

  it("verifies a signed Stripe webhook payload", () => {
    const body = JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test" } }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = "whsec_test";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

    const event = verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`, secret);

    expect(event.id).toBe("evt_test");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects invalid signatures", () => {
    const body = JSON.stringify({ id: "evt_test", type: "ping", data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000);

    expect(() => verifyStripeWebhook(body, `t=${timestamp},v1=deadbeef`, "whsec_test")).toThrow(
      "Invalid Stripe webhook signature"
    );
  });

  it("creates Checkout sessions with subscription metadata", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_stripe_secret";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    const fetchMock = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("mode")).toBe("subscription");
      expect(body.get("client_reference_id")).toBe("ws_1");
      expect(body.get("line_items[0][price]")).toBe("price_pro");
      expect(body.get("metadata[workspaceId]")).toBe("ws_1");
      expect(body.get("subscription_data[metadata][tier]")).toBe("pro");
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk_stripe_secret" });
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await createStripeCheckoutSession({
      tier: "pro",
      workspaceId: "ws_1",
      customerEmail: "billing@example.com",
      origin: "https://modeltruth.ai"
    });

    expect(session).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.stripe.com/v1/checkout/sessions", expect.any(Object));
  });

  it("creates Customer Portal sessions for existing Stripe customers", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_stripe_secret";
    const fetchMock = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("customer")).toBe("cus_1");
      expect(body.get("return_url")).toBe("https://modeltruth.ai/en/pricing");
      return new Response(JSON.stringify({ id: "bps_1", url: "https://billing.stripe.com/session/bps_1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await createStripePortalSession({ customerId: "cus_1", origin: "https://modeltruth.ai" });

    expect(session.url).toBe("https://billing.stripe.com/session/bps_1");
    expect(fetchMock).toHaveBeenCalledWith("https://api.stripe.com/v1/billing_portal/sessions", expect.any(Object));
  });
});
