import { NextResponse } from "next/server";
import { createAuthRepository } from "@modeltruth/db";
import { clearSessionCookie, getCurrentSession, SESSION_COOKIE } from "../../../../../lib/auth";

export async function POST() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createAuthRepository();
  try {
    const deleted = await repo.deleteUserAccount(session.user.id);
    if (!deleted) return NextResponse.json({ error: "user not found" }, { status: 404 });
    const response = NextResponse.json({ deleted: true });
    response.cookies.set(clearSessionCookie());
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } finally {
    await repo.close();
  }
}
