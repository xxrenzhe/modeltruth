import type { UpdateWorkspaceBillingInput } from "@modeltruth/db";
import type { StripeEvent } from "./stripe";

export async function processStripeEvent(
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
    return;
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    await updateWorkspaceBilling({
      workspaceId: metadataValue(object, "workspaceId"),
      stripeCustomerId: stringValue(object.customer),
      stripeSubscriptionId: stringValue(object.subscription),
      subscriptionStatus: event.type === "invoice.paid" ? "active" : "past_due",
      tier: normalizeTier(metadataValue(object, "tier"))
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeTier(value: string | undefined): string | undefined {
  if (value === "pro" || value === "team") return value;
  return undefined;
}

function metadataValue(object: Record<string, unknown>, key: string): string | undefined {
  return metadataRecordValue(object.metadata, key) ?? nestedMetadataValue(object, "subscription_details", key);
}

function nestedMetadataValue(object: Record<string, unknown>, nestedKey: string, key: string): string | undefined {
  const nested = object[nestedKey];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return undefined;
  return metadataRecordValue((nested as Record<string, unknown>).metadata, key);
}

function metadataRecordValue(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return stringValue((metadata as Record<string, unknown>)[key]);
}
