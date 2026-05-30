import { runSmokeAudit } from "@modeltruth/audit-engine";
import { decryptSecret } from "@modeltruth/crypto";
import { createJobRepository, createProviderNodeRepository, ensureDatabaseReady, saveAuditRun } from "@modeltruth/db";

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const workerId = `audit-worker-${process.pid}`;

export async function runWorkerTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.claimNext({ workerId, types: ["heartbeat", "deepAudit"] });
    if (!job) return;
    try {
      const payload = await parseAuditJobPayload(job.payloadJson);
      const result = await runSmokeAudit({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
        suiteId: payload.suite
      });
      const parsedSuite = parseSuiteId(payload.suite);
      await saveAuditRun({
        id: result.runId,
        workspaceId: payload.workspaceId,
        nodeId: payload.nodeId,
        suiteId: parsedSuite.suiteId,
        suiteVersion: parsedSuite.suiteVersion,
        runType: job.type,
        targetModelId: payload.model,
        status: result.overallStatus,
        confidence: result.confidence,
        metrics: result.metrics,
        assertions: result.assertions,
        evidenceSummary: result.evidenceSummary,
        finishedAt: new Date().toISOString()
      });
      if (["fail", "error", "warning"].includes(result.overallStatus) && payload.workspaceId) {
        await repo.enqueue({
          type: "alert",
          payload: {
            workspaceId: payload.workspaceId,
            nodeId: payload.nodeId,
            runId: result.runId,
            status: result.overallStatus,
            confidence: result.confidence,
            message: `ModelTruth audit ${result.overallStatus} for ${payload.model}`,
            createdAt: new Date().toISOString()
          }
        });
      }
      await repo.complete(job.id);
      console.log(`[worker] completed ${job.type} job ${job.id}`);
    } catch (error) {
      await repo.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  } finally {
    await repo.close();
  }
}

async function parseAuditJobPayload(payloadJson: string) {
  const payload = JSON.parse(payloadJson) as {
    workspaceId?: string;
    nodeId?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    modelId?: string;
    suiteId?: string;
  };

  if (payload.nodeId) {
    const nodes = await createProviderNodeRepository();
    try {
      const node = await nodes.getForAudit(payload.nodeId);
      if (!node?.encryptedApiKey) throw new Error(`provider node ${payload.nodeId} is missing encrypted key material`);
      return {
        workspaceId: node.workspaceId,
        nodeId: node.id,
        baseUrl: node.baseUrl,
        apiKey: decryptSecret(node.encryptedApiKey),
        model: node.modelId,
        suite: payload.suiteId ?? "smoke@1.0.0"
      };
    } finally {
      await nodes.close();
    }
  }

  if (!payload.baseUrl || !payload.apiKey || !(payload.model ?? payload.modelId)) {
    throw new Error("audit job payload requires nodeId or baseUrl/apiKey/model");
  }
  return {
    workspaceId: payload.workspaceId,
    nodeId: payload.nodeId,
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey,
    model: payload.model ?? payload.modelId!,
    suite: payload.suiteId ?? "smoke@1.0.0"
  };
}

function parseSuiteId(value: string) {
  const [suiteId, suiteVersion = "1.0.0"] = value.split("@");
  return { suiteId: suiteId || "smoke", suiteVersion };
}

async function main() {
  await ensureDatabaseReady();
  await runWorkerTick();
  if (process.env.RUN_ONCE === "1") return;
  setInterval(() => {
    runWorkerTick().catch((error) => console.error("[worker] tick failed", error));
  }, intervalMs);
}

if (process.argv[1]?.endsWith("apps/worker/src/index.ts")) {
  main().catch((error) => {
    console.error("[worker] fatal", error);
    process.exit(1);
  });
}
