import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createProviderNodeRepository } from "@modeltruth/db";
import { encryptSecret, getSecretSuffix, redactSecrets } from "@modeltruth/crypto";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createProviderNodeRepository();
  try {
    return NextResponse.json({ nodes: await repo.list(session.workspace.id) });
  } finally {
    await repo.close();
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createProviderNodeRepository();
  try {
    const body = await request.json();
    const baseUrl = validateBaseUrl(String(body.baseUrl ?? ""));
    const apiKey = String(body.apiKey ?? "");
    if (!apiKey) return NextResponse.json({ error: "apiKey is required" }, { status: 400 });

    const node = await repo.create({
      workspaceId: session.workspace.id,
      name: String(body.name ?? "Primary Gateway"),
      baseUrl: baseUrl.toString(),
      baseUrlHostHash: createHash("sha256").update(baseUrl.host).digest("hex"),
      modelId: String(body.modelId ?? body.model ?? ""),
      encryptedApiKey: encryptSecret(apiKey),
      apiKeySuffix: getSecretSuffix(apiKey),
      heartbeatIntervalSeconds: Number(body.heartbeatIntervalSeconds ?? 300),
      deepAuditIntervalSeconds: Number(body.deepAuditIntervalSeconds ?? 43200)
    });
    return NextResponse.json(redactSecrets({ node }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  } finally {
    await repo.close();
  }
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("baseUrl must use HTTPS");
  if (!isPublicHostname(url.hostname)) {
    throw new Error("local endpoints are not allowed");
  }
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
