import { NextResponse } from "next/server";
import { createProviderSubscriptionRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import {
  parseNotificationType,
  parseProviderSlug,
  parseProviderSubscriptionBody,
  parseProviderSubscriptionQuery,
  parseSubscriptionEmail
} from "../subscription-input";

export async function GET(request: Request) {
  return unsubscribe(parseProviderSubscriptionQuery(request));
}

export async function POST(request: Request) {
  try {
    return await unsubscribe(await parseProviderSubscriptionBody(request));
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid unsubscribe request") }, { status: 400 });
  }
}

async function unsubscribe(body: Record<string, unknown>) {
  try {
    const providerSlug = parseProviderSlug(body.providerSlug);
    const email = parseSubscriptionEmail(body.email);
    const notificationType = parseNotificationType(body.notificationType);
    const repo = await createProviderSubscriptionRepository();
    try {
      const subscription = await repo.unsubscribe({ providerSlug, email, notificationType });
      return NextResponse.json({ subscription: publicSubscription(providerSlug, notificationType, subscription?.status ?? "unsubscribed") });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid unsubscribe request") }, { status: 400 });
  }
}

function publicSubscription(providerSlug: string, notificationType: string, status: string) {
  return { providerSlug, notificationType, status };
}
