import {
  applyAuditRetentionPolicy,
  createJobRepository,
  createModelRegistryRepository,
  createProviderNodeRepository,
  createProviderSubscriptionRepository,
  getPublicAuditSummary,
  ensureDatabaseReady
} from "@modeltruth/db";
import { installGracefulShutdown, writeJsonLog } from "@modeltruth/shared";

const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);
const calibrationIntervalMs = Number(process.env.MODELTRUTH_CALIBRATION_INTERVAL_MS ?? 7 * 24 * 60 * 60 * 1000);
const scheduledDeepAuditSuites = ["smoke@1.0.0", "reasoning-lite@1.0.0", "context-lite@1.0.0"] as const;

export async function runSchedulerTick() {
  await runRetentionMaintenance();
  const jobs = await createJobRepository();
  const nodes = await createProviderNodeRepository();
  try {
    const now = new Date();
    const dueNodes = await nodes.listDueForSchedule(now);
    for (const node of dueNodes) {
      if (!node.nextHeartbeatAt || new Date(node.nextHeartbeatAt) <= now) {
        const fingerprint = scheduleFingerprint(node.id, "heartbeat", now, node.heartbeatIntervalSeconds);
        if (!(await jobs.hasActiveFingerprint("heartbeat", fingerprint))) {
          const job = await jobs.enqueue({
            type: "heartbeat",
            payload: { source: "scheduler", nodeId: node.id, scheduledAt: now.toISOString(), fingerprint }
          });
          await nodes.markScheduled(node.id, "heartbeat", new Date(now.getTime() + node.heartbeatIntervalSeconds * 1000));
          writeJsonLog({
            service: "scheduler",
            event: "job.enqueued",
            data: { jobId: job.id, jobType: job.type, nodeId: node.id }
          });
        }
      }
      if (!node.nextDeepAuditAt || new Date(node.nextDeepAuditAt) <= now) {
        const suiteId = deepAuditSuiteForWindow(node.id, now, node.deepAuditIntervalSeconds);
        const fingerprint = scheduleFingerprint(node.id, "deepAudit", now, node.deepAuditIntervalSeconds, suiteId);
        if (!(await jobs.hasActiveFingerprint("deepAudit", fingerprint))) {
          const job = await jobs.enqueue({
            type: "deepAudit",
            payload: { source: "scheduler", nodeId: node.id, suiteId, scheduledAt: now.toISOString(), fingerprint }
          });
          await nodes.markScheduled(node.id, "deepAudit", new Date(now.getTime() + node.deepAuditIntervalSeconds * 1000));
          writeJsonLog({
            service: "scheduler",
            event: "job.enqueued",
            data: { jobId: job.id, jobType: job.type, nodeId: node.id }
          });
        }
      }
    }
    if (dueNodes.length === 0) writeJsonLog({ service: "scheduler", event: "nodes.none_due" });
    await enqueueDueCalibrations(jobs, now);
    await enqueueProviderDigests(jobs, now);
  } finally {
    await nodes.close();
    await jobs.close();
  }
}

async function enqueueProviderDigests(jobs: Awaited<ReturnType<typeof createJobRepository>>, now: Date) {
  const summary = await getPublicAuditSummary();
  const subscriptions = await createProviderSubscriptionRepository();
  try {
    for (const provider of summary.providers) {
      for (const notificationType of ["weekly_digest", "risk_trend"] as const) {
        if (notificationType === "risk_trend" && provider.riskFlags.length === 0) continue;
        const subscribers = await subscriptions.listByProviderAndType(provider.providerSlug, notificationType);
        if (subscribers.length === 0) continue;
        const fingerprint = `providerDigest:${provider.providerSlug}:${notificationType}:${digestWindow(now, notificationType)}`;
        if (await jobs.hasActiveFingerprint("providerDigest", fingerprint)) continue;
        const job = await jobs.enqueue({
          type: "providerDigest",
          payload: {
            fingerprint,
            providerSlug: provider.providerSlug,
            providerName: provider.providerSlug,
            notificationType,
            subscriberEmails: subscribers.map((subscriber) => subscriber.email),
            status: provider.riskFlags.length > 0 ? "warning" : "pass",
            uptime: provider.windows["24h"].uptime,
            p95TtftMs: provider.windows["24h"].p95TtftMs,
            auditPassRate: provider.windows["24h"].passRate,
            riskFlagCount: provider.riskFlags.length,
            evidenceScore: provider.evidenceScore,
            scheduledAt: now.toISOString()
          }
        });
        writeJsonLog({
          service: "scheduler",
          event: "job.enqueued",
          data: { jobId: job.id, jobType: job.type, providerSlug: provider.providerSlug, notificationType }
        });
      }
    }
  } finally {
    await subscriptions.close();
  }
}

function digestWindow(now: Date, notificationType: "weekly_digest" | "risk_trend") {
  const days = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  return notificationType === "weekly_digest" ? Math.floor(days / 7) : days;
}

function deepAuditSuiteForWindow(nodeId: string, now: Date, intervalSeconds: number) {
  const windowStart = scheduleWindowStart(now, intervalSeconds);
  const index = Math.abs(hashString(`${nodeId}:${windowStart}`)) % scheduledDeepAuditSuites.length;
  return scheduledDeepAuditSuites[index];
}

function scheduleFingerprint(nodeId: string, type: "heartbeat" | "deepAudit", now: Date, intervalSeconds: number, suiteId?: string) {
  const suitePart = suiteId ? `:${suiteId}` : "";
  return `${type}:${nodeId}:${scheduleWindowStart(now, intervalSeconds)}${suitePart}`;
}

function scheduleWindowStart(now: Date, intervalSeconds: number) {
  return Math.floor(now.getTime() / Math.max(intervalSeconds, 1) / 1000);
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

async function runRetentionMaintenance() {
  const result = await applyAuditRetentionPolicy();
  if (result.deletedAggregateRuns || result.deletedFreePlaygroundRuns || result.redactedPrivateEvidenceRuns) {
    writeJsonLog({ service: "scheduler", event: "retention.applied", data: { ...result } });
  }
}

async function enqueueDueCalibrations(jobs: Awaited<ReturnType<typeof createJobRepository>>, now: Date) {
  const registry = await createModelRegistryRepository();
  try {
    const cutoff = new Date(now.getTime() - calibrationIntervalMs);
    const dueModels = await registry.listDueForCalibration(cutoff);
    for (const model of dueModels) {
      const suiteId = model.baselineSuiteVersion;
      const fingerprint = `calibration:${model.provider}:${model.modelId}:${suiteId}`;
      if (await jobs.hasActiveFingerprint("calibration", fingerprint)) continue;
      const job = await jobs.enqueue({
        type: "calibration",
        maxAttempts: 2,
        payload: {
          source: "scheduler",
          fingerprint,
          provider: model.provider,
          modelId: model.modelId,
          suiteId,
          scheduledAt: now.toISOString()
        }
      });
      writeJsonLog({
        service: "scheduler",
        event: "job.enqueued",
        data: { jobId: job.id, jobType: job.type, provider: model.provider, modelId: model.modelId }
      });
    }
  } finally {
    await registry.close();
  }
}

async function main() {
  if (process.env.SKIP_RUNTIME_DB_INIT !== "true") await ensureDatabaseReady();
  await runSchedulerTick();
  if (process.env.RUN_ONCE === "1") return;
  const timer = setInterval(() => {
    runSchedulerTick().catch((error) => writeJsonLog({ service: "scheduler", event: "tick.failed", level: "error", error }));
  }, intervalMs);
  installGracefulShutdown({ service: "scheduler", cleanup: () => clearInterval(timer) });
}

if (process.argv[1]?.endsWith("apps/scheduler/src/index.ts")) {
  main().catch((error) => {
    writeJsonLog({ service: "scheduler", event: "fatal", level: "error", error });
    process.exit(1);
  });
}
