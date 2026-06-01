import { NextResponse } from "next/server";
import { createBillingRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { verifyStripeWebhook, type StripeEvent } from "../../../../lib/stripe";
import { processStripeEvent } from "../../../../lib/billing-webhook";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured" }, { status: 503 });

  const rawBody = await request.text();
  let event: StripeEvent;
  try {
    event = verifyStripeWebhook(rawBody, request.headers.get("stripe-signature"), secret);
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid signature") }, { status: 400 });
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
