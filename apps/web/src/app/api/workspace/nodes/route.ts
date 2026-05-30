import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createProviderNodeRepository } from "@modeltruth/db";
import { encryptSecret, getSecretSuffix, redactSecrets } from "@modeltruth/crypto";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "default_workspace";
  const repo = await createProviderNodeRepository();
  try {
    return NextResponse.json({ nodes: await repo.list(workspaceId) });
  } finally {
    await repo.close();
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const baseUrl = validateBaseUrl(String(body.baseUrl ?? ""));
  const apiKey = String(body.apiKey ?? "");
  if (!apiKey) return NextResponse.json({ error: "apiKey is required" }, { status: 400 });

  const repo = await createProviderNodeRepository();
  try {
    const node = await repo.create({
      workspaceId: String(body.workspaceId ?? "default_workspace"),
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
  } finally {
    await repo.close();
  }
}

function validateBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("baseUrl must use HTTPS");
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
    throw new Error("local endpoints are not allowed");
  }
  return url;
}
