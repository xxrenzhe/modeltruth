import { NextResponse } from "next/server";
import { createAlertChannelRepository, type AlertChannelType } from "@modeltruth/db";
import { encryptSecret } from "@modeltruth/crypto";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createAlertChannelRepository();
  try {
    return NextResponse.json({ channels: await repo.list(session.workspace.id) });
  } finally {
    await repo.close();
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  try {
    const body = await request.json();
    const type = parseType(body.type);
    const target = validateTarget(String(body.target ?? ""));
    const repo = await createAlertChannelRepository();
    try {
      const channel = await repo.create({
        workspaceId: session.workspace.id,
        type,
        encryptedTarget: encryptSecret(target.toString())
      });
      return NextResponse.json({ channel }, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}

function parseType(value: unknown): AlertChannelType {
  if (value === "webhook" || value === "slack" || value === "discord") return value;
  throw new Error("unsupported alert channel type");
}

function validateTarget(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("alert target must use HTTPS");
  if (!isPublicHostname(url.hostname)) throw new Error("local alert targets are not allowed");
  return url;
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (["localhost", "metadata.google.internal"].includes(normalized)) return false;
  if (normalized.endsWith(".localhost") || normalized.endsWith(".local")) return false;
  if (/^169\.254\./.test(normalized)) return false;
  if (/^10\./.test(normalized)) return false;
  if (/^127\./.test(normalized)) return false;
  if (/^192\.168\./.test(normalized)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return false;
  if (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  return true;
}
