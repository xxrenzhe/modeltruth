import { cookies } from "next/headers";
import { createAuthRepository, type AuthSession } from "@modeltruth/db";

export const SESSION_COOKIE = "mt_session";

export async function getCurrentSession(): Promise<AuthSession | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;

  const repo = await createAuthRepository();
  try {
    return await repo.getSession(token);
  } finally {
    await repo.close();
  }
}

export function createSessionCookie(token: string, expiresAt: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt)
  };
}

export function clearSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  };
}
