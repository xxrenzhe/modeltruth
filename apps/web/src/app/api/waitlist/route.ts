import { NextResponse } from "next/server";
import { createWaitlistRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";

export async function POST(request: Request) {
  try {
    const body = await parseBody(request);
    const repo = await createWaitlistRepository();
    try {
      const signup = await repo.create({
        email: parseEmail(body.email),
        role: parseOptionalText(body.role),
        company: parseOptionalText(body.company),
        source: parseOptionalSource(body.source)
      });
      return NextResponse.json({ signup: publicSignup(signup) }, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid waitlist signup") }, { status: 400 });
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

function parseEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("valid email is required");
  return email;
}

function parseOptionalText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text.slice(0, 120) : undefined;
}

function parseOptionalSource(value: unknown) {
  if (typeof value !== "string") return "homepage";
  const source = value.trim().toLowerCase();
  return /^[a-z0-9_.:-]{2,80}$/.test(source) ? source : "homepage";
}

function publicSignup(signup: { source: string; status: string; createdAt: string }) {
  return {
    source: signup.source,
    status: signup.status,
    createdAt: signup.createdAt
  };
}
