import { NextResponse } from "next/server";
import { createAuthRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const canExposeDevLink = process.env.NODE_ENV !== "production" || process.env.AUTH_DEV_EXPOSE_MAGIC_LINK === "true";
    if (!process.env.AUTH_MAGIC_LINK_WEBHOOK_URL && !canExposeDevLink) {
      return NextResponse.json({ error: "magic link delivery is not configured" }, { status: 503 });
    }

    const repo = await createAuthRepository();
    try {
      const link = await repo.createMagicLink(String(body.email ?? ""));
      const verificationUrl = new URL("/api/auth/verify", request.url);
      verificationUrl.searchParams.set("token", link.token);
      await deliverMagicLink(link.email, verificationUrl.toString());

      return NextResponse.json({
        ok: true,
        email: link.email,
        expiresAt: link.expiresAt,
        verificationUrl: canExposeDevLink ? verificationUrl.toString() : undefined
      });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Unable to create magic link") }, { status: 400 });
  }
}

async function deliverMagicLink(email: string, verificationUrl: string) {
  const webhookUrl = process.env.AUTH_MAGIC_LINK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.AUTH_MAGIC_LINK_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.AUTH_MAGIC_LINK_WEBHOOK_TOKEN}` }
        : {})
    },
    body: JSON.stringify({ email, verificationUrl })
  });

  if (!response.ok) {
    throw new Error(`magic link delivery failed with ${response.status}`);
  }
}
