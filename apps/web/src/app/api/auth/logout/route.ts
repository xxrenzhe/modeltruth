import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAuthRepository } from "@modeltruth/db";
import { clearSessionCookie, SESSION_COOKIE } from "../../../../lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const repo = await createAuthRepository();
    try {
      await repo.destroySession(token);
    } finally {
      await repo.close();
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearSessionCookie());
  return response;
}
