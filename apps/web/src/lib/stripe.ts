import { createHmac, timingSafeEqual } from "node:crypto";

export type BillingTier = "pro" | "team";

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface CreateCheckoutInput {
  tier: BillingTier;
  workspaceId: string;
  customerId?: string;
  customerEmail: string;
  origin: string;
}

export interface CreatePortalInput {
  customerId: string;
  origin: string;
}

export async function createStripeCheckoutSession(input: CreateCheckoutInput) {
  const priceId = getStripePriceId(input.tier);
  return stripeFormRequest("/v1/checkout/sessions", {
    mode: "subscription",
    success_url: `${input.origin}/en/pricing?checkout=success`,
    cancel_url: `${input.origin}/en/pricing?checkout=cancelled`,
    client_reference_id: input.workspaceId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[workspaceId]": input.workspaceId,
    "metadata[tier]": input.tier,
    "subscription_data[metadata][workspaceId]": input.workspaceId,
    "subscription_data[metadata][tier]": input.tier,
    ...(input.customerId ? { customer: input.customerId } : { customer_email: input.customerEmail })
  });
}

export async function createStripePortalSession(input: CreatePortalInput) {
  return stripeFormRequest("/v1/billing_portal/sessions", {
    customer: input.customerId,
    return_url: `${input.origin}/en/pricing`
  });
}

export function verifyStripeWebhook(rawBody: string, signatureHeader: string | null, endpointSecret: string): StripeEvent {
  if (!signatureHeader) throw new Error("Missing Stripe-Signature header");
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=", 2);
      return [key, value];
    })
  );
  const timestamp = Number(parts.t);
  const expected = parts.v1;
  if (!Number.isFinite(timestamp) || !expected) throw new Error("Invalid Stripe-Signature header");
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error("Stripe webhook timestamp outside tolerance");

  const actual = createHmac("sha256", endpointSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  if (!safeEqualHex(actual, expected)) throw new Error("Invalid Stripe webhook signature");

  const parsed = JSON.parse(rawBody);
  if (!parsed?.id || !parsed?.type || !parsed?.data?.object) throw new Error("Invalid Stripe event payload");
  return parsed as StripeEvent;
}

export function getStripePriceId(tier: BillingTier) {
  const value = tier === "team" ? process.env.STRIPE_TEAM_PRICE_ID : process.env.STRIPE_PRO_PRICE_ID;
  if (!value) throw new Error(`Missing Stripe price id for ${tier}`);
  return value;
}

async function stripeFormRequest(path: string, params: Record<string, string>) {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) throw new Error("STRIPE_SECRET_KEY is not configured");

  const response = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });
  const payload = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Stripe request failed with ${response.status}`);
  if (!payload.url) throw new Error("Stripe response did not include a URL");
  return { id: payload.id, url: payload.url };
}

function safeEqualHex(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
