import { NextResponse } from "next/server";
import { getPublicAuditSummary, listAuditRuns } from "@modeltruth/db";
import { getCurrentSession } from "../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("scope") === "public") {
    return NextResponse.json({ summary: await getPublicAuditSummary() });
  }

  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const runs = await listAuditRuns({ workspaceId: session.workspace.id, limit: 100 });
  return NextResponse.json({ runs: runs.map(toEvidenceListItem) });
}

function toEvidenceListItem(run: Awaited<ReturnType<typeof listAuditRuns>>[number]) {
  return {
    runId: run.runId,
    suiteId: run.suiteId,
    runType: run.runType,
    targetModelId: run.targetModelId,
    status: run.status,
    confidence: run.confidence,
    metrics: publicListMetrics(run.metrics),
    createdAt: run.createdAt
  };
}

function publicListMetrics(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return stripUndefined({
    statusCode: numberValue(record.statusCode),
    ttftMs: numberValue(record.ttftMs),
    totalLatencyMs: numberValue(record.totalLatencyMs)
  });
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function stripUndefined(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
