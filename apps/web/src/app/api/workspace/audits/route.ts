import { NextResponse } from "next/server";
import { getAuditSuite } from "@modeltruth/audit-engine";
import { createJobRepository, createProviderNodeRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";
import { traceIdFromRequest } from "../../../../lib/request-trace";

const manualWorkspaceSuites = new Set(["smoke", "reasoning-lite", "context-lite", "billing-lite"]);
const manualAuditWindowMs = 10 * 60 * 1000;
const manualAuditLimits: Record<string, number> = { pro: 6, team: 20 };

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (!["pro", "team"].includes(session.workspace.tier)) {
    return NextResponse.json({ error: "manual workspace audits require a Pro or Team subscription" }, { status: 403 });
  }

  const nodes = await createProviderNodeRepository();
  const jobs = await createJobRepository();
  try {
    const body = await request.json();
    const nodeId = parseNodeId(body.nodeId);
    const suite = getAuditSuite(String(body.suiteId ?? "smoke@1.0.0"));
    if (!manualWorkspaceSuites.has(suite.suiteId)) {
      return NextResponse.json({ error: "suite is not available for manual workspace audits" }, { status: 400 });
    }

    const node = await nodes.getForAudit(nodeId);
    if (!node || node.workspaceId !== session.workspace.id) {
      return NextResponse.json({ error: "node not found" }, { status: 404 });
    }

    const suiteId = `${suite.suiteId}@${suite.suiteVersion}`;
    const requestId = request.headers.get("x-request-id")?.trim() || undefined;
    const fingerprint = `manual:${session.workspace.id}:${node.id}:${suiteId}`;
    const duplicate = await jobs.hasActiveFingerprint("deepAudit", fingerprint);
    const limit = manualAuditLimits[session.workspace.tier] ?? 0;
    const since = new Date(Date.now() - manualAuditWindowMs);
    const recentCount = await jobs.countRecentWorkspaceManualAudits(session.workspace.id, since);
    if (!duplicate && recentCount >= limit) {
      return NextResponse.json(
        { error: "manual audit rate limit exceeded", retryAfterSeconds: Math.ceil(manualAuditWindowMs / 1000) },
        { status: 429, headers: buildRateLimitHeaders(limit, 0) }
      );
    }
    if (!duplicate) {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          source: "workspace-manual",
          workspaceId: session.workspace.id,
          nodeId: node.id,
          suiteId,
          requestedByUserId: session.user.id,
          requestedAt: new Date().toISOString(),
          requestId,
          traceId: traceIdFromRequest(request),
          fingerprint
        }
      });
    }

    return NextResponse.json(
      {
        audit: {
          status: duplicate ? "alreadyQueued" : "queued",
          nodeId: node.id,
          suiteId,
          duplicate
        }
      },
      {
        status: duplicate ? 200 : 201,
        headers: buildRateLimitHeaders(limit, Math.max(limit - recentCount - (duplicate ? 0 : 1), 0))
      }
    );
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid audit request") }, { status: 400 });
  } finally {
    await nodes.close();
    await jobs.close();
  }
}

function parseNodeId(value: unknown) {
  const nodeId = typeof value === "string" ? value.trim() : "";
  if (!nodeId) throw new Error("nodeId is required");
  return nodeId;
}

function buildRateLimitHeaders(limit: number, remaining: number) {
  return {
    "retry-after": String(Math.ceil(manualAuditWindowMs / 1000)),
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-window": String(Math.ceil(manualAuditWindowMs / 1000))
  };
}
