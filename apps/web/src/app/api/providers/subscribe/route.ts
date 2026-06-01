import { NextResponse } from "next/server";
import { createProviderSubscriptionRepository } from "@modeltruth/db";
import { isKnownProviderSlug } from "@modeltruth/seo";
import { safeErrorMessage } from "@modeltruth/shared";

export async function POST(request: Request) {
  try {
    const body = await parseBody(request);
    const providerSlug = parseProviderSlug(body.providerSlug);
    const email = parseEmail(body.email);
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

async function parseBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return request.json();
}

function parseProviderSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new Error("providerSlug is required");
  if (!isKnownProviderSlug(slug)) throw new Error("providerSlug is not supported");
  return slug;
}

function parseEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("valid email is required");
  return email;
}

function parseNotificationType(value: unknown) {
  if (value === undefined || value === null || value === "") return "risk_trend";
  if (value === "risk_trend" || value === "weekly_digest") return value;
  throw new Error("notificationType must be risk_trend or weekly_digest");
}

function publicSubscription(subscription: { providerSlug: string; notificationType: string; status: string; createdAt: string }) {
  return {
    providerSlug: subscription.providerSlug,
    notificationType: subscription.notificationType,
    status: subscription.status,
    createdAt: subscription.createdAt
  };
}
