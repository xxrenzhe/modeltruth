import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { getAuditSuite, runSmokeAudit } from "@modeltruth/audit-engine";
import { createModelRegistryRepository, createPlaygroundQuotaRepository, saveAuditRun } from "@modeltruth/db";
import { redactSecrets } from "@modeltruth/crypto";
import { assertPublicResolvedAddresses, validatePublicHttpsUrl, writeJsonLog } from "@modeltruth/shared";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await request.json()
      : Object.fromEntries((await request.formData()).entries());

    const parsedSuite = resolvePlaygroundSuite(String(body.suiteId ?? "smoke@1.0.0"));
    const suite = `${parsedSuite.suiteId}@${parsedSuite.suiteVersion}`;
    const baseUrl = validatePublicHttpsUrl(String(body.baseUrl ?? ""), "Base URL");
    await assertPublicResolvedAddresses(baseUrl, resolvePublicDns, "Base URL");
    const quota = await consumePlaygroundQuota(request);
    if (!quota.allowed) {
      return NextResponse.json(
        { error: "daily playground audit limit reached", quota },
        { status: 429, headers: { "x-ratelimit-limit": String(quota.limit), "x-ratelimit-remaining": "0" } }
      );
    }
    const model = String(body.model ?? "");
    const providerSlug = providerSlugFromBaseUrl(baseUrl.toString()) ?? "custom";
    const modelProfile = await resolveModelProfile(providerSlug, model);
    const result = await runSmokeAudit({
      baseUrl: baseUrl.toString(),
      apiKey: String(body.apiKey ?? ""),
      model,
      suiteId: suite,
      modelProfile
    });

    await saveAuditRun({
      id: result.runId,
      traceId: result.traceId,
      providerSlug: providerSlug === "custom" ? undefined : providerSlug,
      suiteId: parsedSuite.suiteId,
      suiteVersion: parsedSuite.suiteVersion,
      runType: "playground",
      targetModelId: model,
      status: result.overallStatus,
      confidence: result.confidence,
      metrics: result.metrics,
      assertions: result.assertions,
      evidenceSummary: result.evidenceSummary,
      finishedAt: new Date().toISOString()
    });
    writeJsonLog({
      service: "web",
      event: "audit.completed",
      data: {
        traceId: result.traceId,
        runId: result.runId,
        suiteId: parsedSuite.suiteId,
        suiteVersion: parsedSuite.suiteVersion,
        providerHostHash: result.evidenceSummary.targetHostHash,
        latencyBreakdown: result.evidenceSummary.latencyTimeline,
        redactionApplied: result.evidenceSummary.redaction === "applied",
        runType: "playground",
        status: result.overallStatus
      }
    });

    return NextResponse.json(redactSecrets({ ...result, quota }), {
      headers: {
        "x-ratelimit-limit": String(quota.limit),
        "x-ratelimit-remaining": String(quota.remaining)
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "audit failed" }, { status: 400 });
  }
}

async function resolvePublicDns(hostname: string) {
  if (process.env.VITEST === "true") return [{ address: "203.0.113.10" }];
  return lookup(hostname, { all: true });
}

async function resolveModelProfile(provider: string, modelId: string) {
  const repo = await createModelRegistryRepository();
  try {
    return (
      (await repo.get(provider, modelId)) ??
      (await repo.upsert({
        provider,
        modelId,
        family: modelFamily(modelId),
        status: "experimental",
        supportsReasoningUsage: false,
        supportsStreaming: true
      }))
    );
  } finally {
    await repo.close();
  }
}

function modelFamily(modelId: string) {
  const [family = "unknown"] = modelId.split(/[:/.-]/);
  return family || "unknown";
}

function parseSuiteId(value: string) {
  const [suiteId, suiteVersion = "1.0.0"] = value.split("@");
  return { suiteId: suiteId || "smoke", suiteVersion };
}

function resolvePlaygroundSuite(value: string) {
  const suite = getAuditSuite(value);
  if (!["smoke", "reasoning-lite", "context-lite"].includes(suite.suiteId)) {
    throw new Error("Playground supports smoke@1.0.0, reasoning-lite@1.0.0 and context-lite@1.0.0 only");
  }
  return suite;
}

function providerSlugFromBaseUrl(baseUrl: string): string | undefined {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes("openai")) return "openai";
    if (host.includes("anthropic")) return "anthropic";
    if (host.includes("openrouter")) return "openrouter";
    if (host.includes("google") || host.includes("gemini")) return "google-gemini";
    return undefined;
  } catch {
    return undefined;
  }
}

async function consumePlaygroundQuota(request: Request) {
  const quotaKey = await quotaKeyFromRequest(request);
  const repo = await createPlaygroundQuotaRepository();
  try {
    return await repo.consume(quotaKey);
  } finally {
    await repo.close();
  }
}

async function quotaKeyFromRequest(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const fingerprint = request.headers.get("x-modeltruth-fingerprint") || request.headers.get("user-agent") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}:${fingerprint}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
