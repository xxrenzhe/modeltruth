import { NextResponse } from "next/server";
import { createByoProbeRepository, createProviderNodeRepository, saveAuditRun } from "@modeltruth/db";
import { redactSecrets } from "@modeltruth/crypto";
import { safeErrorMessage } from "@modeltruth/shared";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = String(bearer ?? body.token ?? "");
    if (!token.startsWith("mtp_")) return NextResponse.json({ error: "probe token is required" }, { status: 401 });

    const repo = await createByoProbeRepository();
    try {
      const probe = await repo.heartbeat({ token, version: typeof body.version === "string" ? body.version : undefined });
      if (!probe) return NextResponse.json({ error: "probe token not found" }, { status: 404 });
      if (body.result && typeof body.result === "object") await saveProbeResult(probe, body.result as Record<string, unknown>);
      return NextResponse.json({ ok: true, probe, targets: await probeTargets(probe.workspaceId) });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid probe heartbeat") }, { status: 400 });
  }
}

async function probeTargets(workspaceId: string) {
  const nodes = await createProviderNodeRepository();
  try {
    return (await nodes.list(workspaceId)).map((node) => ({
      nodeId: node.id,
      baseUrl: node.baseUrl,
      modelId: node.modelId,
      heartbeatIntervalSeconds: node.heartbeatIntervalSeconds,
      deepAuditIntervalSeconds: node.deepAuditIntervalSeconds
    }));
  } finally {
    await nodes.close();
  }
}

async function saveProbeResult(probe: { id: string; workspaceId: string; region: string }, result: Record<string, unknown>) {
  const nodeId = stringValue(result.nodeId);
  if (nodeId && !(await nodeBelongsToWorkspace(probe.workspaceId, nodeId))) {
    throw new Error("probe result nodeId is not registered for this workspace");
  }
  const suite = stringValue(result.suiteId) ?? "external-probe@1.0.0";
  const [suiteId, suiteVersion = "1.0.0"] = suite.split("@");
  const evidenceSummary = sanitizeProbeEvidenceSummary(result.evidenceSummary);
  await saveAuditRun({
    id: stringValue(result.runId) ?? crypto.randomUUID(),
    traceId: stringValue(result.traceId),
    workspaceId: probe.workspaceId,
    nodeId,
    suiteId: suiteId || "external-probe",
    suiteVersion,
    runType: "externalProbe",
    targetModelId: stringValue(result.modelId) ?? "unknown",
    status: statusValue(result.status),
    confidence: numberValue(result.confidence),
    metrics: sanitizeProbeMetrics(result.metrics),
    assertions: sanitizeProbeAssertions(result.assertions),
    evidenceSummary: redactSecrets({
      ...evidenceSummary,
      externalProbe: true,
      probeId: probe.id,
      probeRegion: probe.region,
      requestBodyStored: false
    }),
    finishedAt: new Date().toISOString()
  });
}

async function nodeBelongsToWorkspace(workspaceId: string, nodeId: string) {
  const nodes = await createProviderNodeRepository();
  try {
    return (await nodes.list(workspaceId)).some((node) => node.id === nodeId);
  } finally {
    await nodes.close();
  }
}

function sanitizeProbeMetrics(value: unknown) {
  const metrics = pickObject(value, ["statusCode", "ttftMs", "totalLatencyMs", "tokenUsage", "billingVariance"]);
  if (metrics.tokenUsage) metrics.tokenUsage = pickObject(metrics.tokenUsage, ["prompt", "completion", "total"]);
  if (metrics.billingVariance) metrics.billingVariance = pickObject(metrics.billingVariance, ["reportedTokens", "expectedTokens", "varianceRatio"]);
  return redactSecrets(metrics);
}

function sanitizeProbeAssertions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return redactSecrets(value.map((assertion) => pickObject(assertion, ["id", "status", "confidence", "message"])));
}

function sanitizeProbeEvidenceSummary(value: unknown) {
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
  return redactSecrets(evidenceSummary);
}

function sanitizeStoredHeaders(value: unknown) {
  return redactSecrets(pickObject(value, ["content-type", "x-request-id", "openai-processing-ms"]));
}

function pickObject(value: unknown, allowedKeys: string[]) {
  const record = recordValue(value);
  if (!record) return {};
  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(record, key))
      .map((key) => [key, record[key]])
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function statusValue(value: unknown) {
  const status = stringValue(value);
  return status && ["pass", "warning", "fail", "inconclusive", "error"].includes(status) ? status : "inconclusive";
}
