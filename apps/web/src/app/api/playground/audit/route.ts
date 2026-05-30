import { NextResponse } from "next/server";
import { runSmokeAudit } from "@modeltruth/audit-engine";
import { redactSecrets } from "@modeltruth/crypto";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json()
    : Object.fromEntries((await request.formData()).entries());

  const result = await runSmokeAudit({
    baseUrl: String(body.baseUrl ?? ""),
    apiKey: String(body.apiKey ?? ""),
    model: String(body.model ?? ""),
    suiteId: String(body.suiteId ?? "smoke@1.0.0")
  });

  return NextResponse.json(redactSecrets(result));
}
