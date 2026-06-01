import { NextResponse } from "next/server";
import { getAuditSuite } from "@modeltruth/audit-engine";
import { createJobRepository, createProviderNodeRepository } from "@modeltruth/db";
import { getCurrentSession } from "../../../../lib/auth";

const manualWorkspaceSuites = new Set(["smoke", "reasoning-lite", "context-lite", "billing-lite"]);

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
    const fingerprint = `manual:${session.workspace.id}:${node.id}:${suiteId}`;
    const duplicate = await jobs.hasActiveFingerprint("deepAudit", fingerprint);
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
      { status: duplicate ? 200 : 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid audit request" }, { status: 400 });
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
