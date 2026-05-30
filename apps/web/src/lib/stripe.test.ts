import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeWebhook } from "./stripe";

describe("verifyStripeWebhook", () => {
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
});
