import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import {
  createAuthRepository,
  createJobRepository,
  createProviderNodeRepository,
  ensureSqliteReady,
  listAuditRuns,
  saveAuditRun
} from "@modeltruth/db";
import { runWorkerTick } from "./index";

describe("runWorkerTick provider-node audit jobs", () => {
  it("loads encrypted node credentials and persists workspace/node observability", async () => {
    const harness = await createHarness("modeltruth-worker-node-audit-");
    const workspaceId = await createWorkspace();
    const node = await createNode(workspaceId);
    await enqueueNodeAudit(node.id);
    const calls: Array<{ url: string; authorization?: string }> = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), authorization: (init?.headers as Record<string, string>)?.authorization });
      return new Response(
        JSON.stringify({
          model: "gpt-5.1",
          choices: [{ message: { content: "modeltruth-smoke-node" } }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    await runWorkerTick();

    const runs = await listAuditRuns({ workspaceId });
    const run = runs[0];
    harness.cleanup();

    expect(calls[0]).toMatchObject({
      url: "https://api.node.example.com/v1/chat/completions",
      authorization: "Bearer sk-node-secret-123456"
    });
    expect(run).toMatchObject({
      workspaceId,
      nodeId: node.id,
      suiteId: "smoke",
      runType: "heartbeat",
      targetModelId: "gpt-5.1"
    });
    expect(run.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(run)).not.toContain("sk-node-secret");
  });

  it("uses a node TTFT threshold when enqueueing latency alerts", async () => {
    const harness = await createHarness("modeltruth-worker-node-ttft-alert-");
    const workspaceId = await createWorkspace();
    const node = await createNode(workspaceId, 1000);
    await saveAuditRun({
      id: "previous_ttft_warning",
      workspaceId,
      nodeId: node.id,
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      status: "pass",
      confidence: 0.9,
      metrics: { statusCode: 200, ttftMs: 2500 },
      assertions: [],
      evidenceSummary: { requestBodyStored: false },
      createdAt: new Date(Date.now() - 60_000).toISOString()
    });
    await enqueueNodeAudit(node.id);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: "modeltruth-smoke-node" } }],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    await runWorkerTick();

    const jobs = await createJobRepository();
    try {
      const alerts = await claimAlerts(jobs);
      const payload = alerts.find((item) => item.rule === "p95_ttft");
      expect(payload).toBeTruthy();
      expect(payload).toMatchObject({
        workspaceId,
        nodeId: node.id,
        rule: "p95_ttft",
        status: "warning"
      });
      expect(String(payload?.message)).toContain("exceeds 1000ms");
    } finally {
      await jobs.close();
      harness.cleanup();
    }
  });
});

async function createHarness(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  return {
    cleanup() {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  };
}

async function createWorkspace() {
  const auth = await createAuthRepository();
  try {
    const link = await auth.createMagicLink(`node-audit-${crypto.randomUUID()}@example.com`);
    const login = await auth.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create workspace");
    return login.session.workspace.id;
  } finally {
    await auth.close();
  }
}

async function createNode(workspaceId: string, ttftThresholdMs = 3000) {
  const repo = await createProviderNodeRepository();
  try {
    return await repo.create({
      workspaceId,
      name: "Node audit",
      baseUrl: "https://api.node.example.com/v1",
      baseUrlHostHash: "node_host_hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret("sk-node-secret-123456"),
      apiKeySuffix: getSecretSuffix("sk-node-secret-123456"),
      ttftThresholdMs
    });
  } finally {
    await repo.close();
  }
}

async function claimAlerts(jobs: Awaited<ReturnType<typeof createJobRepository>>) {
  const alerts: Array<Record<string, unknown>> = [];
  for (;;) {
    const alert = await jobs.claimNext({ workerId: "node-alert-test", types: ["alert"] });
    if (!alert) return alerts;
    alerts.push(JSON.parse(alert.payloadJson) as Record<string, unknown>);
  }
}

async function enqueueNodeAudit(nodeId: string) {
  const jobs = await createJobRepository();
  try {
    await jobs.enqueue({ type: "heartbeat", payload: { nodeId, suiteId: "smoke@1.0.0" } });
  } finally {
    await jobs.close();
  }
}
