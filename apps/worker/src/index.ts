import { runSmokeAudit } from "@modeltruth/audit-engine";
import { decryptSecret } from "@modeltruth/crypto";
import {
  createJobRepository,
  createModelRegistryRepository,
  createProviderDisputeRepository,
  createProviderNodeRepository,
  createWorkspacePrivacyRepository,
  ensureDatabaseReady,
  listAuditRuns,
  saveAuditRun
} from "@modeltruth/db";
import { installGracefulShutdown, writeJsonLog } from "@modeltruth/shared";
import { evaluateAlertRules } from "./alert-rules";

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const jobHeartbeatMs = Number(process.env.WORKER_JOB_HEARTBEAT_MS ?? 30_000);
const workerId = `audit-worker-${process.pid}`;

export async function runWorkerTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.claimNext({ workerId, types: ["heartbeat", "deepAudit", "calibration", "disputeReview"] });
    if (!job) return;
    const heartbeat = startJobHeartbeat(repo, job.id);
    try {
      if (job.type === "disputeReview") {
        await runDisputeReviewJob(job.payloadJson);
        await repo.complete(job.id);
        writeJsonLog({ service: "worker", event: "job.completed", data: { jobId: job.id, jobType: job.type } });
        return;
      }
      if (job.type === "calibration") {
        await runCalibrationJob(job.payloadJson);
        await repo.complete(job.id);
        writeJsonLog({ service: "worker", event: "job.completed", data: { jobId: job.id, jobType: job.type } });
        return;
      }
      const payload = await parseAuditJobPayload(job.payloadJson);
      const providerSlug = providerSlugFromBaseUrl(payload.baseUrl);
      const modelProfile = await resolveModelProfile(providerSlug ?? "custom", payload.model);
      const privacySettings = payload.workspaceId ? await resolveWorkspacePrivacySettings(payload.workspaceId) : undefined;
      const result = await runSmokeAudit({
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
        suiteId: payload.suite,
        modelProfile,
        billingSnapshot: payload.billingSnapshot,
        saveFullResponse: privacySettings?.saveFullResponses === true
      });
      const parsedSuite = parseSuiteId(payload.suite);
      const evidenceSummary = {
        ...result.evidenceSummary,
        ...(payload.retestOfRunId ? { retestOfRunId: payload.retestOfRunId } : {}),
        ...(payload.billingRetest ? { billingRetest: true } : {})
      };
      await saveAuditRun({
        id: result.runId,
        traceId: result.traceId,
        providerSlug,
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
        evidenceSummary,
        finishedAt: new Date().toISOString()
      });
      writeAuditCompletedLog({
        jobType: job.type,
        result,
        payload,
        providerHostHash: evidenceSummary.targetHostHash,
        parsedSuite
      });
      const alertRules = payload.workspaceId
        ? evaluateAlertRules({
            workspaceId: payload.workspaceId,
            nodeId: payload.nodeId,
            runId: result.runId,
            runType: job.type,
            targetModelId: payload.model,
            result: { ...result, evidenceSummary },
            history: await listAuditRuns({ workspaceId: payload.workspaceId, limit: 200 })
          })
        : [];
      for (const alertRule of alertRules) {
        const fingerprint = alertFingerprint(payload.workspaceId!, payload.nodeId, alertRule.rule, alertRule.status);
        if (await repo.hasRecentFingerprint("alert", fingerprint, new Date(Date.now() - 24 * 60 * 60 * 1000))) {
          continue;
        }
        await repo.enqueue({
          type: "alert",
          payload: {
            workspaceId: payload.workspaceId,
            nodeId: payload.nodeId,
            runId: result.runId,
            fingerprint,
            status: alertRule.status,
            confidence: result.confidence,
            message: alertRule.message,
            rule: alertRule.rule,
            createdAt: new Date().toISOString()
          }
        });
      }
      if (shouldRetestBillingVariance(result.evidenceSummary.billingVariance, payload)) {
        await repo.enqueue({
          type: "deepAudit",
          payload: {
            ...payload.originalPayload,
            suiteId: payload.suite,
            retestOfRunId: result.runId,
            billingRetest: true,
            scheduledAt: new Date().toISOString()
          },
          maxAttempts: 1
        });
      }
      await repo.complete(job.id);
      writeJsonLog({ service: "worker", event: "job.completed", data: { jobId: job.id, jobType: job.type } });
    } catch (error) {
      await repo.fail(job.id, error instanceof Error ? error.message : String(error));
    } finally {
      heartbeat.stop();
    }
  } finally {
    await repo.close();
  }
}

async function runDisputeReviewJob(payloadJson: string) {
  const payload = JSON.parse(payloadJson) as { disputeId?: string; providerSlug?: string; reviewDueAt?: string };
  if (!payload.disputeId || !payload.providerSlug) throw new Error("dispute review job requires disputeId and providerSlug");
  if (payload.reviewDueAt && Number.isNaN(new Date(payload.reviewDueAt).getTime())) {
    throw new Error("dispute review job has invalid reviewDueAt");
  }
  const disputes = await createProviderDisputeRepository();
  try {
    const updated = await disputes.markProviderResponseAttached(payload.disputeId);
    if (!updated) throw new Error(`dispute ${payload.disputeId} not found`);
    writeJsonLog({
      service: "worker",
      event: "dispute.review_attached",
      data: { disputeId: updated.id, providerSlug: updated.providerSlug, status: updated.status, reviewDueAt: updated.reviewDueAt }
    });
  } finally {
    await disputes.close();
  }
}

async function runCalibrationJob(payloadJson: string) {
  const payload = JSON.parse(payloadJson) as { provider?: string; modelId?: string; suiteId?: string };
  if (!payload.provider || !payload.modelId) throw new Error("calibration job requires provider and modelId");
  const endpoint = calibrationEndpoint(payload.provider);
  const apiKey = calibrationApiKey(payload.provider);
  if (!endpoint || !apiKey) throw new Error(`missing calibration endpoint or API key for ${payload.provider}`);

  const registry = await createModelRegistryRepository();
  try {
    const modelProfile = await registry.get(payload.provider, payload.modelId);
    const suite = payload.suiteId ?? modelProfile?.baselineSuiteVersion ?? "fingerprint-calibration@1.0.0";
    const result = await runSmokeAudit({
      baseUrl: endpoint,
      apiKey,
      model: payload.modelId,
      suiteId: suite,
      modelProfile
    });
    const parsedSuite = parseSuiteId(suite);
    await registry.recordCalibration({
      provider: payload.provider,
      modelId: payload.modelId,
      suiteId: parsedSuite.suiteId,
      suiteVersion: parsedSuite.suiteVersion,
      status: result.overallStatus,
      metrics: result.metrics,
      evidenceSummary: result.evidenceSummary
    });
  } finally {
    await registry.close();
  }
}

function startJobHeartbeat(repo: Awaited<ReturnType<typeof createJobRepository>>, jobId: string) {
  const timer = setInterval(() => {
    repo
      .heartbeat(jobId, workerId)
      .catch((error) => writeJsonLog({ service: "worker", event: "job.heartbeat_failed", level: "error", error }));
  }, jobHeartbeatMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    }
  };
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
    billingSnapshot?: {
      expectedCostUsd: number;
      balanceBeforeUsd: number;
      balanceAfterUsd: number;
    };
    billingRetest?: boolean;
    retestOfRunId?: string;
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
        suite: payload.suiteId ?? "smoke@1.0.0",
        billingSnapshot: payload.billingSnapshot,
        billingRetest: payload.billingRetest ?? Boolean(payload.retestOfRunId),
        retestOfRunId: payload.retestOfRunId,
        originalPayload: payload
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
    suite: payload.suiteId ?? "smoke@1.0.0",
    billingSnapshot: payload.billingSnapshot,
    billingRetest: payload.billingRetest ?? Boolean(payload.retestOfRunId),
    retestOfRunId: payload.retestOfRunId,
    originalPayload: payload
  };
}

function shouldRetestBillingVariance(
  billingVariance: unknown,
  payload: Awaited<ReturnType<typeof parseAuditJobPayload>>
) {
  if (payload.billingRetest) return false;
  if (payload.suite.split("@")[0] !== "billing-lite") return false;
  if (!billingVariance || typeof billingVariance !== "object" || Array.isArray(billingVariance)) return false;
  return (billingVariance as Record<string, unknown>).retestRequired === true;
}

function alertFingerprint(workspaceId: string, nodeId: string | undefined, rule: string, status: string) {
  return `alert:${workspaceId}:${nodeId ?? "workspace"}:${rule}:${status}`;
}

function writeAuditCompletedLog(input: {
  jobType: string;
  result: Awaited<ReturnType<typeof runSmokeAudit>>;
  payload: Awaited<ReturnType<typeof parseAuditJobPayload>>;
  providerHostHash: unknown;
  parsedSuite: { suiteId: string; suiteVersion: string };
}) {
  writeJsonLog({
    service: "worker",
    event: "audit.completed",
    data: {
      traceId: input.result.traceId,
      runId: input.result.runId,
      workspaceId: input.payload.workspaceId,
      nodeId: input.payload.nodeId,
      suiteId: input.parsedSuite.suiteId,
      suiteVersion: input.parsedSuite.suiteVersion,
      providerHostHash: typeof input.providerHostHash === "string" ? input.providerHostHash : undefined,
      latencyBreakdown: input.result.evidenceSummary.latencyTimeline,
      redactionApplied: input.result.evidenceSummary.redaction === "applied",
      runType: input.jobType,
      status: input.result.overallStatus
    }
  });
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

async function resolveWorkspacePrivacySettings(workspaceId: string) {
  const repo = await createWorkspacePrivacyRepository();
  try {
    return await repo.get(workspaceId);
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

function calibrationEndpoint(provider: string) {
  const normalized = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return process.env[`MODELTRUTH_CALIBRATION_${normalized}_BASE_URL`] ?? process.env.MODELTRUTH_CALIBRATION_BASE_URL;
}

function calibrationApiKey(provider: string) {
  const normalized = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return process.env[`MODELTRUTH_CALIBRATION_${normalized}_API_KEY`] ?? process.env.MODELTRUTH_CALIBRATION_API_KEY;
}

async function main() {
  if (process.env.SKIP_RUNTIME_DB_INIT !== "true") await ensureDatabaseReady();
  await runWorkerTick();
  if (process.env.RUN_ONCE === "1") return;
  const timer = setInterval(() => {
    runWorkerTick().catch((error) => writeJsonLog({ service: "worker", event: "tick.failed", level: "error", error }));
  }, intervalMs);
  installGracefulShutdown({ service: "worker", cleanup: () => clearInterval(timer) });
}

if (process.argv[1]?.endsWith("apps/worker/src/index.ts")) {
  main().catch((error) => {
    writeJsonLog({ service: "worker", event: "fatal", level: "error", error });
    process.exit(1);
  });
}
