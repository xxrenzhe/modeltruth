import { NextResponse } from "next/server";
import { getAuditSuite } from "@modeltruth/audit-engine";
import { redactSecrets } from "@modeltruth/crypto";
import { saveAuditRun } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const body = await request.json();
  if (body.consent !== true) return NextResponse.json({ error: "consent=true is required" }, { status: 400 });

  const reportId = crypto.randomUUID();
  let parsedSuite;
  try {
    parsedSuite = getAuditSuite(String(body.suiteId ?? "smoke@1.0.0"));
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "Unsupported audit suite") }, { status: 400 });
  }
  const payload = redactSecrets({
    id: reportId,
    workspaceId: session.workspace.id,
    receivedAt: new Date().toISOString(),
    schemaVersion: body.schemaVersion,
    runId: body.runId,
    status: body.status,
    confidence: body.confidence,
    metrics: sanitizeMetrics(body.metrics),
    assertions: sanitizeAssertions(body.assertions),
    evidenceSummary: sanitizeEvidenceSummary(body.evidenceSummary)
  });

  await saveAuditRun({
    id: reportId,
    workspaceId: session.workspace.id,
    suiteId: parsedSuite.suiteId,
    suiteVersion: parsedSuite.suiteVersion,
    runType: "cli",
    targetModelId: String(body.model ?? body.targetModelId ?? "unknown"),
    status: String(body.status ?? "unknown"),
    confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    metrics: payload.metrics ?? {},
    assertions: payload.assertions ?? [],
    evidenceSummary: payload.evidenceSummary ?? {},
    finishedAt: payload.receivedAt
  });

  return NextResponse.json({ uploaded: true, runId: reportId, report: payload });
}

function sanitizeMetrics(value: unknown) {
  const metrics = pickObject(value, ["statusCode", "ttftMs", "totalLatencyMs", "tokenUsage", "billingVariance"]);
  if (metrics.tokenUsage) metrics.tokenUsage = pickObject(metrics.tokenUsage, ["prompt", "completion", "total"]);
  if (metrics.billingVariance) metrics.billingVariance = pickObject(metrics.billingVariance, ["reportedTokens", "expectedTokens", "varianceRatio"]);
  return metrics;
}

function sanitizeAssertions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((assertion) => pickObject(assertion, ["id", "status", "confidence", "message"]));
}

function sanitizeEvidenceSummary(value: unknown) {
  const evidenceSummary = pickObject(value, [
    "redaction",
    "requestBodyStored",
    "authorizationHeaderStored",
    "storedHeaders",
    "promptNonceHash",
    "numericNonceHash",
    "timestampBucket",
    "retestRecommendation",
    "completionHash",
    "usageHash",
    "calibrationSnapshotId",
    "billingVariance"
  ]);
  if (evidenceSummary.storedHeaders) evidenceSummary.storedHeaders = sanitizeStoredHeaders(evidenceSummary.storedHeaders);
  if (evidenceSummary.billingVariance) {
    evidenceSummary.billingVariance = pickObject(evidenceSummary.billingVariance, ["reportedTokens", "expectedTokens", "varianceRatio"]);
  }
  return evidenceSummary;
}

function sanitizeStoredHeaders(value: unknown) {
  const headers = pickObject(value, ["content-type", "x-request-id", "openai-processing-ms"]);
  return redactSecrets(headers);
}

function pickObject(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, (value as Record<string, unknown>)[key]])
  );
}
