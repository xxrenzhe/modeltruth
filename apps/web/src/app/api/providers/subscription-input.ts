import { isKnownProviderSlug } from "@modeltruth/seo";

export async function parseProviderSubscriptionBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return request.json();
}

export function parseProviderSubscriptionQuery(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export function parseProviderSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new Error("providerSlug is required");
  if (!isKnownProviderSlug(slug)) throw new Error("providerSlug is not supported");
  return slug;
}

export function parseSubscriptionEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("valid email is required");
  return email;
}

export function parseNotificationType(value: unknown) {
  if (value === undefined || value === null || value === "") return "risk_trend";
  if (value === "risk_trend" || value === "weekly_digest") return value;
  throw new Error("notificationType must be risk_trend or weekly_digest");
}
