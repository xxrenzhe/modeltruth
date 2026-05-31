import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { createAlertChannelRepository, type AlertChannelType } from "@modeltruth/db";
import { encryptSecret } from "@modeltruth/crypto";
import { assertPublicResolvedAddresses, validatePublicHttpsUrl } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";
import { resolveNodeSchedulePolicy, validateAlertChannelCreation } from "../../../../lib/workspace-tier-policy";

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
    const target = await validateTarget(type, body);
    const repo = await createAlertChannelRepository();
    try {
      const existingChannels = await repo.list(session.workspace.id);
      const policy = resolveNodeSchedulePolicy(session.workspace.tier);
      validateAlertChannelCreation(policy, existingChannels);
      const channel = await repo.create({
        workspaceId: session.workspace.id,
        type,
        encryptedTarget: encryptSecret(target),
        targetSuffix: suffixTarget(type, target)
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
  if (value === "webhook" || value === "slack" || value === "discord" || value === "email" || value === "telegram") return value;
  throw new Error("unsupported alert channel type");
}

async function validateTarget(type: AlertChannelType, body: Record<string, unknown>): Promise<string> {
  const value = String(body.target ?? "");
  if (type === "email") {
    const normalized = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("email alert target must be an email address");
    return normalized;
  }
  if (type === "telegram") {
    const parsed = parseTelegramTarget(body);
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(parsed.botToken)) throw new Error("telegram bot token is invalid");
    if (!/^-?\d{4,}$|^@[A-Za-z0-9_]{5,}$/.test(parsed.chatId)) throw new Error("telegram chat id is invalid");
    return JSON.stringify(parsed);
  }
  try {
    const url = validatePublicHttpsUrl(value, "alert target");
    await assertPublicResolvedAddresses(url, resolvePublicDns, "alert target");
    return url.toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("public endpoint") || message.includes("address is not public")) {
      throw new Error("local alert targets are not allowed");
    }
    throw error;
  }
}

async function resolvePublicDns(hostname: string) {
  if (process.env.VITEST === "true") return [{ address: "203.0.113.10" }];
  return lookup(hostname, { all: true });
}

function suffixTarget(type: AlertChannelType, target: string) {
  if (type === "email") {
    const [local, domain] = target.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (type === "telegram") {
    const parsed = JSON.parse(target) as { chatId: string };
    return `telegram:${parsed.chatId}`;
  }
  return target.length <= 12 ? target : target.slice(-12);
}

function parseTelegramTarget(body: Record<string, unknown>) {
  if (typeof body.target === "string" && body.target.trim().startsWith("{")) {
    const parsed = JSON.parse(body.target) as { botToken?: unknown; chatId?: unknown };
    return { botToken: String(parsed.botToken ?? ""), chatId: String(parsed.chatId ?? "") };
  }
  return {
    botToken: String(body.botToken ?? "").trim(),
    chatId: String(body.chatId ?? "").trim()
  };
}
