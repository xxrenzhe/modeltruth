import { NextResponse } from "next/server";
import { createAuthRepository } from "@modeltruth/db";
import { createSessionCookie } from "../../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

  const repo = await createAuthRepository();
  try {
    const result = await repo.consumeMagicLink(token);
    if (!result) return NextResponse.json({ error: "invalid or expired token" }, { status: 401 });

    const redirectUrl = new URL("/en/playground", request.url);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(createSessionCookie(result.sessionToken, result.session.expiresAt));
    return response;
  } finally {
    await repo.close();
  }
}
