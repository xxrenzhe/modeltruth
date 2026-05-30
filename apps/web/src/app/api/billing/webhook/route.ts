import { NextResponse } from "next/server";
import { createBillingRepository, type UpdateWorkspaceBillingInput } from "@modeltruth/db";
import { verifyStripeWebhook, type StripeEvent } from "../../../../lib/stripe";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, { status: 503 });

  const rawBody = await request.text();
  let event: StripeEvent;
  try {
    event = verifyStripeWebhook(rawBody, request.headers.get("stripe-signature"), secret);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid signature" }, { status: 400 });
  }

  const billing = await createBillingRepository();
  try {
    const shouldProcess = await billing.markStripeEventProcessed(event.id, event.type, rawBody);
    if (!shouldProcess) return NextResponse.json({ received: true, duplicate: true });
    await processStripeEvent(event, (input) => billing.updateWorkspaceBilling(input));
    return NextResponse.json({ received: true });
  } finally {
    await billing.close();
  }
}

async function processStripeEvent(
  event: StripeEvent,
  updateWorkspaceBilling: (input: UpdateWorkspaceBillingInput) => Promise<void>
) {
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    await updateWorkspaceBilling({
      workspaceId: stringValue(object.client_reference_id) ?? metadataValue(object, "workspaceId"),
      stripeCustomerId: stringValue(object.customer),
      stripeSubscriptionId: stringValue(object.subscription),
      subscriptionStatus: "active",
      tier: normalizeTier(metadataValue(object, "tier"))
    });
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    await updateWorkspaceBilling({
      stripeCustomerId: stringValue(object.customer),
      stripeSubscriptionId: stringValue(object.id),
      subscriptionStatus: stringValue(object.status) ?? "inactive",
      tier: normalizeTier(metadataValue(object, "tier"))
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeTier(value: string | undefined): string {
  return value === "team" ? "team" : "pro";
}

function metadataValue(object: Record<string, unknown>, key: string): string | undefined {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return stringValue((metadata as Record<string, unknown>)[key]);
}
