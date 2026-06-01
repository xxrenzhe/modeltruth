import { NextResponse } from "next/server";
import { createProviderSubscriptionRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { parseNotificationType, parseProviderSlug, parseProviderSubscriptionBody, parseSubscriptionEmail } from "../subscription-input";

export async function POST(request: Request) {
  try {
    const body = await parseProviderSubscriptionBody(request);
    const providerSlug = parseProviderSlug(body.providerSlug);
    const email = parseSubscriptionEmail(body.email);
    const notificationType = parseNotificationType(body.notificationType);
    const repo = await createProviderSubscriptionRepository();
    try {
      const subscription = await repo.create({ providerSlug, email, notificationType });
      return NextResponse.json({ subscription: publicSubscription(subscription) }, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid subscription") }, { status: 400 });
  }
}

function publicSubscription(subscription: { providerSlug: string; notificationType: string; status: string; createdAt: string }) {
  return {
    providerSlug: subscription.providerSlug,
    notificationType: subscription.notificationType,
    status: subscription.status,
    createdAt: subscription.createdAt
  };
}
