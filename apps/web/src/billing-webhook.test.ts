import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthRepository, createBillingRepository, ensureSqliteReady } from "@modeltruth/db";
import type { StripeEvent } from "./lib/stripe";
import { processStripeEvent } from "./lib/billing-webhook";
import { POST as postBillingWebhook } from "./app/api/billing/webhook/route";

let previousDatabasePath: string | undefined;
let previousWebhookSecret: string | undefined;
let tempDir: string | undefined;

describe("processStripeEvent", () => {
  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("maps all PRD-required Stripe webhook events into billing updates", async () => {
    const updates: unknown[] = [];
    const update = async (input: unknown) => {
      updates.push(input);
    };

    await processStripeEvent(event("checkout.session.completed", { client_reference_id: "ws_1", customer: "cus_1", subscription: "sub_1", metadata: { tier: "pro" } }), update);
    await processStripeEvent(event("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "trialing", metadata: { tier: "team" } }), update);
    await processStripeEvent(event("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled", metadata: { tier: "team" } }), update);
    await processStripeEvent(event("invoice.paid", { customer: "cus_1", subscription: "sub_1", subscription_details: { metadata: { workspaceId: "ws_1", tier: "team" } } }), update);
    await processStripeEvent(event("invoice.payment_failed", { customer: "cus_1", subscription: "sub_1", metadata: { workspaceId: "ws_1", tier: "pro" } }), update);

    expect(updates).toEqual([
      { workspaceId: "ws_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", tier: "pro" },
      { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "trialing", tier: "team" },
      { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "canceled", tier: "team" },
      { workspaceId: "ws_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", tier: "team" },
      { workspaceId: "ws_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "past_due", tier: "pro" }
    ]);
  });

  it("does not turn missing or unsupported Stripe metadata tiers into paid access", async () => {
    const updates: unknown[] = [];
    const update = async (input: unknown) => {
      updates.push(input);
    };

    await processStripeEvent(event("checkout.session.completed", { client_reference_id: "ws_1", customer: "cus_1", subscription: "sub_1" }), update);
    await processStripeEvent(event("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "active", metadata: { tier: "enterprise" } }), update);

    expect(updates).toEqual([
      { workspaceId: "ws_1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", tier: undefined },
      { stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", tier: undefined }
    ]);
  });

  it("deduplicates repeated signed webhook deliveries at the API route", async () => {
    const { workspaceId } = await createBillingHarness();
    const rawBody = JSON.stringify(
      event("checkout.session.completed", {
        client_reference_id: workspaceId,
        customer: "cus_route",
        subscription: "sub_route",
        metadata: { tier: "team" }
      })
    );
    const signature = stripeSignature(rawBody, process.env.STRIPE_WEBHOOK_SECRET!);

    const first = await postBillingWebhook(signedRequest(rawBody, signature));
    const second = await postBillingWebhook(signedRequest(rawBody, signature));
    const firstBody = await first.json();
    const secondBody = await second.json();
    const billing = await createBillingRepository();
    const workspace = await billing.getWorkspaceBilling(workspaceId);
    await billing.close();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody).toEqual({ received: true });
    expect(secondBody).toEqual({ received: true, duplicate: true });
    expect(workspace).toMatchObject({
      tier: "team",
      stripeCustomerId: "cus_route",
      stripeSubscriptionId: "sub_route",
      subscriptionStatus: "active"
    });
  });

  it("processes all PRD-required signed webhook events at the API route", async () => {
    const { workspaceId } = await createBillingHarness();

    await postSignedEvent(
      event("checkout.session.completed", {
        client_reference_id: workspaceId,
        customer: "cus_matrix",
        subscription: "sub_matrix",
        metadata: { tier: "pro" }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "pro", subscriptionStatus: "active" });

    await postSignedEvent(
      event("customer.subscription.updated", {
        id: "sub_matrix",
        customer: "cus_matrix",
        status: "trialing",
        metadata: { tier: "team" }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "team", subscriptionStatus: "trialing" });

    await postSignedEvent(
      event("customer.subscription.deleted", {
        id: "sub_matrix",
        customer: "cus_matrix",
        status: "canceled",
        metadata: { tier: "team" }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "free", subscriptionStatus: "canceled" });

    await postSignedEvent(
      event("invoice.paid", {
        customer: "cus_matrix",
        subscription: "sub_matrix",
        subscription_details: { metadata: { workspaceId, tier: "team" } }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "team", subscriptionStatus: "active" });

    await postSignedEvent(
      event("invoice.payment_failed", {
        customer: "cus_matrix",
        subscription: "sub_matrix",
        metadata: { workspaceId, tier: "pro" }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "free", subscriptionStatus: "past_due" });
  });

  it("keeps paid access constrained to supported Stripe metadata tiers at the API route", async () => {
    const { workspaceId } = await createBillingHarness();

    await postSignedEvent(
      event("checkout.session.completed", {
        client_reference_id: workspaceId,
        customer: "cus_unknown",
        subscription: "sub_unknown",
        metadata: { tier: "enterprise" }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "free", subscriptionStatus: "active" });

    await postSignedEvent(
      event("customer.subscription.updated", {
        id: "sub_unknown",
        customer: "cus_unknown",
        status: "trialing",
        metadata: { tier: "team" }
      })
    );
    await expectWorkspaceBilling(workspaceId, { tier: "team", subscriptionStatus: "trialing" });
  });

  it("does not downgrade an existing paid tier when Stripe omits tier metadata on renewal", async () => {
    const { workspaceId } = await createBillingHarness();

    await postSignedEvent(
      event("checkout.session.completed", {
        client_reference_id: workspaceId,
        customer: "cus_renewal",
        subscription: "sub_renewal",
        metadata: { tier: "team" }
      })
    );
    await postSignedEvent(
      event("invoice.paid", {
        customer: "cus_renewal",
        subscription: "sub_renewal",
        subscription_details: { metadata: { workspaceId } }
      })
    );

    await expectWorkspaceBilling(workspaceId, { tier: "team", subscriptionStatus: "active" });
  });
});

function event(type: string, object: Record<string, unknown>): StripeEvent {
  return { id: `evt_${type}`, type, data: { object } };
}

async function createBillingHarness() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-billing-webhook-route-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_test";
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

  const auth = await createAuthRepository();
  try {
    const link = await auth.createMagicLink("route-billing@example.com");
    const login = await auth.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create billing test session");
    return { workspaceId: login.session.workspace.id };
  } finally {
    await auth.close();
  }
}

function stripeSignature(rawBody: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function postSignedEvent(stripeEvent: StripeEvent) {
  const rawBody = JSON.stringify(stripeEvent);
  const response = await postBillingWebhook(signedRequest(rawBody, stripeSignature(rawBody, process.env.STRIPE_WEBHOOK_SECRET!)));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toEqual({ received: true });
}

async function expectWorkspaceBilling(workspaceId: string, expected: { tier: string; subscriptionStatus: string }) {
  const billing = await createBillingRepository();
  try {
    expect(await billing.getWorkspaceBilling(workspaceId)).toMatchObject(expected);
  } finally {
    await billing.close();
  }
}

function signedRequest(rawBody: string, signature: string) {
  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: rawBody
  });
}
