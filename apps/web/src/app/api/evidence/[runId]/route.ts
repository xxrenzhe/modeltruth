import { NextResponse } from "next/server";
import { deleteAuditRun, getEvidencePackage, normalizePublicUsage, type EvidencePackage } from "@modeltruth/db";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const { runId } = await params;
  const evidence = await getEvidencePackage(runId);
  if (!evidence) return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  if (evidence.workspaceId && evidence.workspaceId !== session.workspace.id) {
    return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  }

  return NextResponse.json({ evidence: sanitizeEvidenceExport(evidence) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const { runId } = await params;
  const evidence = await getEvidencePackage(runId);
  if (!evidence || evidence.workspaceId !== session.workspace.id) {
    return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  }

  await deleteAuditRun(runId);
  return NextResponse.json({ deleted: true, runId });
}

function sanitizeEvidenceExport(evidence: EvidencePackage) {
  return redactEvidenceValue({
    ...evidence,
    metrics: sanitizeMetrics(evidence.metrics),
    assertions: sanitizeAssertions(evidence.assertions),
    evidenceSummary: sanitizeEvidenceSummary(evidence.evidenceSummary)
  });
}

function sanitizeMetrics(value: unknown) {
  const record = asRecord(value);
  const metrics = pick(record, ["statusCode", "ttftMs", "totalLatencyMs", "tokenUsage", "billingVariance", "costEstimate"]);
  if (metrics.tokenUsage) metrics.tokenUsage = normalizePublicUsage(metrics.tokenUsage);
  if (metrics.billingVariance) {
    metrics.billingVariance = pick(asRecord(metrics.billingVariance), ["reportedTokens", "expectedTokens", "varianceRatio"]);
  }
  if (metrics.costEstimate) {
    metrics.costEstimate = pick(asRecord(metrics.costEstimate), ["inputCostUsd", "outputCostUsd", "totalCostUsd", "currency"]);
  }
  return metrics;
}

function sanitizeAssertions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => pick(asRecord(item), ["id", "status", "confidence", "message"]));
}

function sanitizeEvidenceSummary(value: unknown) {
  const record = asRecord(value);
  const summary = pick(record, [
    "redaction",
    "requestBodyStored",
    "responseBodyStored",
    "authorizationHeaderStored",
    "targetHostHash",
    "completionHash",
    "usage",
    "billingVariance",
    "suiteId",
    "suiteVersion",
    "promptNonceHash",
    "numericNonceHash",
    "timestampBucket",
    "retestRecommendation",
    "requestMetadata",
    "responseMetadata",
    "latencyTimeline",
    "promptDiffSummary",
    "responseExcerpt",
    "responseExcerptPolicy",
    "fullResponseStored",
    "fullResponsePolicy",
    "finishReason",
    "errorCode",
    "errorType",
    "traceparent",
    "calibrationSnapshotId",
    "probeId",
    "region"
  ]);
  if (summary.usage) summary.usage = normalizePublicUsage(summary.usage);
  if (summary.responseMetadata) {
    const responseMetadata = pick(asRecord(summary.responseMetadata), ["status", "headers", "usage", "finishReason", "errorCode", "errorType"]);
    if (responseMetadata.usage) responseMetadata.usage = normalizePublicUsage(responseMetadata.usage);
    summary.responseMetadata = responseMetadata;
  }
  return summary;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pick(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function redactEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEvidenceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveEvidenceKey(key) ? "[REDACTED]" : redactEvidenceValue(nested)
      ])
    );
  }
  if (typeof value === "string" && looksLikeSecret(value)) return "[REDACTED]";
  return value;
}

function isSensitiveEvidenceKey(key: string) {
  if (key === "tokenUsage") return false;
  return /(api[-_]?key|authorization|secret|password|encryptedApiKey|accessToken|refreshToken)$/i.test(key);
}

function looksLikeSecret(value: string) {
  return /sk-[A-Za-z0-9_-]{8,}/.test(value) || /^Bearer\s+\S+/i.test(value);
}
