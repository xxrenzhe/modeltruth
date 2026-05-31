import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createJobRepository, createProviderNodeRepository } from "@modeltruth/db";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { assertPublicResolvedAddresses, validatePublicHttpsUrl } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";
import { clampNodeSchedule, resolveNodeSchedulePolicy, validateNodeCreation } from "../../../../lib/workspace-tier-policy";

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
    const baseUrl = await validateBaseUrl(String(body.baseUrl ?? ""));
    const apiKey = String(body.apiKey ?? "");
    if (!apiKey) return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    const existingNodes = await repo.list(session.workspace.id);
    const policy = resolveNodeSchedulePolicy(session.workspace.tier);
    validateNodeCreation(policy, existingNodes);
    const schedule = clampNodeSchedule(policy, body);

    const node = await repo.create({
      workspaceId: session.workspace.id,
      name: String(body.name ?? "Primary Gateway"),
      baseUrl: baseUrl.toString(),
      baseUrlHostHash: createHash("sha256").update(baseUrl.host).digest("hex"),
      modelId: String(body.modelId ?? body.model ?? ""),
      encryptedApiKey: encryptSecret(apiKey),
      apiKeySuffix: getSecretSuffix(apiKey),
      heartbeatIntervalSeconds: schedule.heartbeatIntervalSeconds,
      deepAuditIntervalSeconds: schedule.deepAuditIntervalSeconds
    });
    const initialHeartbeatAt = new Date();
    await enqueueInitialHeartbeat(node.id, initialHeartbeatAt);
    await repo.markScheduled(node.id, "heartbeat", new Date(initialHeartbeatAt.getTime() + node.heartbeatIntervalSeconds * 1000));
    return NextResponse.json({ node }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  } finally {
    await repo.close();
  }
}

async function enqueueInitialHeartbeat(nodeId: string, scheduledAt: Date) {
  const jobs = await createJobRepository();
  try {
    await jobs.enqueue({
      type: "heartbeat",
      runAfter: scheduledAt,
      payload: {
        source: "node-create",
        nodeId,
        scheduledAt: scheduledAt.toISOString(),
        fingerprint: `heartbeat:${nodeId}:initial`
      }
    });
  } finally {
    await jobs.close();
  }
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createProviderNodeRepository();
  try {
    const body = await request.json().catch(() => ({}));
    const nodeId = String(body.nodeId ?? "");
    if (!nodeId) return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
    const deleted = await repo.delete(session.workspace.id, nodeId);
    if (!deleted) return NextResponse.json({ error: "node not found" }, { status: 404 });
    return NextResponse.json({ deleted: true, nodeId });
  } finally {
    await repo.close();
  }
}

async function validateBaseUrl(value: string): Promise<URL> {
  try {
    const url = validatePublicHttpsUrl(value, "baseUrl");
    await assertPublicResolvedAddresses(url, resolvePublicDns, "baseUrl");
    return url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("public endpoint") && !message.includes("address is not public")) throw error;
    throw new Error("local endpoints are not allowed");
  }
}

async function resolvePublicDns(hostname: string) {
  if (process.env.VITEST === "true") return [{ address: "203.0.113.10" }];
  return lookup(hostname, { all: true });
}
