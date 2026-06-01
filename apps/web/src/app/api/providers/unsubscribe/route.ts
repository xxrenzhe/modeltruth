import { NextResponse } from "next/server";
import { parseProviderUnsubscribeToken } from "@modeltruth/crypto";
import { createProviderSubscriptionRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import {
  parseNotificationType,
  parseProviderSlug,
  parseProviderSubscriptionBody,
  parseProviderSubscriptionQuery,
  parseSubscriptionEmail
} from "../subscription-input";

type ProviderUnsubscribeInput = {
  providerSlug?: unknown;
  email?: unknown;
  notificationType?: unknown;
};

export async function GET(request: Request) {
  try {
    const query = parseProviderSubscriptionQuery(request);
    const token = typeof query.token === "string" ? query.token : "";
    if (!token) throw new Error("unsubscribe token is required");
    return await unsubscribe(parseProviderUnsubscribeToken(token));
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid unsubscribe request") }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    return await unsubscribe(await parseProviderSubscriptionBody(request));
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid unsubscribe request") }, { status: 400 });
  }
}

async function unsubscribe(body: ProviderUnsubscribeInput) {
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
