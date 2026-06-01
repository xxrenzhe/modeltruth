import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAuthRepository,
  createBillingRepository,
  createJobRepository,
  createModelRegistryRepository,
  createProviderNodeRepository,
  createProviderSubscriptionRepository,
  ensureSqliteReady
} from "@modeltruth/db";
import { saveAuditRun } from "@modeltruth/db";
import { runSchedulerTick } from "./index";

describe("runSchedulerTick calibration scheduling", () => {
  it("advances heartbeat and deep-audit schedules using the node interval policy", async () => {
    const harness = await createHarness("modeltruth-scheduler-node-intervals-");
    const now = new Date("2026-06-01T00:00:00.000Z");
    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("scheduler-intervals@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({ workspaceId: session!.session.workspace.id, subscriptionStatus: "active", tier: "team" });
    } finally {
      await billing.close();
    }
    const nodes = await createProviderNodeRepository();
    let nodeId = "";
    try {
      const node = await nodes.create({
        workspaceId: session!.session.workspace.id,
        name: "Team interval node",
        baseUrl: "https://api.example.com/v1",
        baseUrlHostHash: "host_hash",
        modelId: "gpt-5.1",
        encryptedApiKey: "encrypted",
        apiKeySuffix: "test",
        heartbeatIntervalSeconds: 60,
        deepAuditIntervalSeconds: 21600
      });
      nodeId = node.id;
    } finally {
      await nodes.close();
    }

    await runSchedulerTick(now);

    const refreshedNodes = await createProviderNodeRepository();
    const jobs = await createJobRepository();
    try {
      const node = (await refreshedNodes.list(session!.session.workspace.id)).find((item) => item.id === nodeId);
      const heartbeat = await jobs.claimNext({ workerId: "test-scheduler", types: ["heartbeat"], now });
      const deepAudit = await jobs.claimNext({ workerId: "test-scheduler", types: ["deepAudit"], now });
      const heartbeatPayload = JSON.parse(heartbeat?.payloadJson ?? "{}");
      const deepAuditPayload = JSON.parse(deepAudit?.payloadJson ?? "{}");

      expect(heartbeat?.type).toBe("heartbeat");
      expect(deepAudit?.type).toBe("deepAudit");
      expect(heartbeatPayload.scheduledAt).toBe(now.toISOString());
      expect(deepAuditPayload.scheduledAt).toBe(now.toISOString());
      expect(node?.nextHeartbeatAt).toBe(new Date(now.getTime() + 60_000).toISOString());
      expect(node?.nextDeepAuditAt).toBe(new Date(now.getTime() + 21_600_000).toISOString());
    } finally {
      await jobs.close();
      await refreshedNodes.close();
      harness.cleanup();
    }
  });

  it("enqueues weekly calibration jobs for due models without duplicating active work", async () => {
    const harness = await createHarness("modeltruth-scheduler-calibration-");
    const registry = await createModelRegistryRepository();
    try {
      await registry.upsert({
        provider: "openai",
        modelId: "gpt-5.1",
        family: "gpt-5",
        status: "experimental",
        supportsReasoningUsage: true,
        supportsStreaming: true
      });
      await registry.upsert({
        provider: "anthropic",
        modelId: "claude",
        family: "claude",
        status: "experimental",
        supportsReasoningUsage: false,
        supportsStreaming: true
      });
      await registry.recordCalibration({
        provider: "anthropic",
        modelId: "claude",
        suiteId: "fingerprint-calibration",
        suiteVersion: "1.0.0",
        status: "pass",
        metrics: {},
        evidenceSummary: {},
        calibratedAt: new Date().toISOString()
      });
    } finally {
      await registry.close();
    }

    await runSchedulerTick();
    await runSchedulerTick();

    const jobs = await createJobRepository();
    try {
      const first = await jobs.claimNext({ workerId: "test-scheduler", types: ["calibration"] });
      const second = await jobs.claimNext({ workerId: "test-scheduler", types: ["calibration"] });
      expect(first?.type).toBe("calibration");
      expect(JSON.parse(first?.payloadJson ?? "{}")).toMatchObject({
        provider: "openai",
        modelId: "gpt-5.1",
        suiteId: "fingerprint-calibration@1.0.0"
      });
      expect(second).toBeUndefined();
    } finally {
      await jobs.close();
      harness.cleanup();
    }
  });

  it("adds idempotency fingerprints to heartbeat and deep-audit jobs", async () => {
    const harness = await createHarness("modeltruth-scheduler-node-fingerprint-");
    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("scheduler-node@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();
    const nodes = await createProviderNodeRepository();
    try {
      await nodes.create({
        workspaceId: session!.session.workspace.id,
        name: "Scheduled node",
        baseUrl: "https://api.example.com/v1",
        baseUrlHostHash: "host_hash",
        modelId: "gpt-5.1",
        encryptedApiKey: "encrypted",
        apiKeySuffix: "test",
        heartbeatIntervalSeconds: 60,
        deepAuditIntervalSeconds: 3600
      });
    } finally {
      await nodes.close();
    }

    await runSchedulerTick();

    const jobs = await createJobRepository();
    try {
      const heartbeat = await jobs.claimNext({ workerId: "test-scheduler", types: ["heartbeat"] });
      const deepAudit = await jobs.claimNext({ workerId: "test-scheduler", types: ["deepAudit"] });
      expect(JSON.parse(heartbeat?.payloadJson ?? "{}").fingerprint).toMatch(/^heartbeat:/);
      const deepAuditPayload = JSON.parse(deepAudit?.payloadJson ?? "{}");
      expect(["smoke@1.0.0", "reasoning-lite@1.0.0", "context-lite@1.0.0"]).toContain(deepAuditPayload.suiteId);
      expect(deepAuditPayload.fingerprint).toMatch(/^deepAudit:/);
      expect(deepAuditPayload.fingerprint).toContain(`:${deepAuditPayload.nodeId}:`);
      expect(deepAuditPayload.fingerprint.endsWith(`:${deepAuditPayload.suiteId}`)).toBe(true);
    } finally {
      await jobs.close();
      harness.cleanup();
    }
  });

  it("downshifts deep audits and alerts when workspace fair-use budget is exceeded", async () => {
    const harness = await createHarness("modeltruth-scheduler-fair-use-");
    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("scheduler-fair-use@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({ workspaceId: session!.session.workspace.id, subscriptionStatus: "active", tier: "pro" });
    } finally {
      await billing.close();
    }
    await saveAuditRun({
      id: "run_fair_use_cost",
      workspaceId: session!.session.workspace.id,
      suiteId: "reasoning-lite",
      suiteVersion: "1.0.0",
      runType: "deepAudit",
      targetModelId: "gpt-5.1",
      status: "pass",
      confidence: 0.9,
      metrics: { costEstimate: { totalCostUsd: 8, currency: "USD" } },
      assertions: [{ id: "COST_TRACKED", status: "pass" }],
      evidenceSummary: { requestBodyStored: false }
    });
    const nodes = await createProviderNodeRepository();
    let nodeId = "";
    try {
      const node = await nodes.create({
        workspaceId: session!.session.workspace.id,
        name: "Costly node",
        baseUrl: "https://api.example.com/v1",
        baseUrlHostHash: "host_hash",
        modelId: "gpt-5.1",
        encryptedApiKey: "encrypted",
        apiKeySuffix: "test",
        heartbeatIntervalSeconds: 60,
        deepAuditIntervalSeconds: 3600
      });
      nodeId = node.id;
      await nodes.markScheduled(nodeId, "heartbeat", new Date(Date.now() + 60_000));
      await nodes.markScheduled(nodeId, "deepAudit", new Date(Date.now() - 60_000));
    } finally {
      await nodes.close();
    }

    await runSchedulerTick();

    const jobs = await createJobRepository();
    const refreshedNodes = await createProviderNodeRepository();
    try {
      const deepAudit = await jobs.claimNext({ workerId: "test-scheduler", types: ["deepAudit"] });
      const alert = await jobs.claimNext({ workerId: "test-scheduler", types: ["alert"] });
      const node = (await refreshedNodes.list(session!.session.workspace.id)).find((item) => item.id === nodeId);
      const payload = JSON.parse(alert?.payloadJson ?? "{}");
      expect(deepAudit).toBeUndefined();
      expect(alert?.type).toBe("alert");
      expect(payload).toMatchObject({
        rule: "fair_use_budget",
        status: "warning",
        fairUse: { action: "downshift", currentMonthCostUsd: 8, budgetUsd: 7.6 }
      });
      expect(new Date(node!.nextDeepAuditAt!).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    } finally {
      await refreshedNodes.close();
      await jobs.close();
      harness.cleanup();
    }
  });

  it("enqueues provider digest and risk trend jobs for opted-in subscribers", async () => {
    const harness = await createHarness("modeltruth-scheduler-provider-digest-");
    await saveAuditRun({
      id: "run_provider_warning",
      providerSlug: "openrouter",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "router-model",
      status: "warning",
      confidence: 0.82,
      metrics: { statusCode: 500, ttftMs: 1200 },
      assertions: [{ id: "HTTP_STATUS_OK", status: "warning" }],
      evidenceSummary: { requestBodyStored: false }
    });
    await saveAuditRun({
      id: "run_provider_retest",
      providerSlug: "openrouter",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "router-model",
      status: "warning",
      confidence: 0.83,
      metrics: { statusCode: 500, ttftMs: 1100 },
      assertions: [{ id: "HTTP_STATUS_OK", status: "warning" }],
      evidenceSummary: { requestBodyStored: false, retestOf: "run_provider_warning" }
    });
    const subscriptions = await createProviderSubscriptionRepository();
    await subscriptions.create({ providerSlug: "openrouter", email: "weekly@example.com", notificationType: "weekly_digest" });
    await subscriptions.create({ providerSlug: "openrouter", email: "risk@example.com", notificationType: "risk_trend" });
    await subscriptions.close();

    await runSchedulerTick();
    await runSchedulerTick();

    const jobs = await createJobRepository();
    try {
      const first = await jobs.claimNext({ workerId: "test-provider-digest", types: ["providerDigest"] });
      const second = await jobs.claimNext({ workerId: "test-provider-digest", types: ["providerDigest"] });
      const third = await jobs.claimNext({ workerId: "test-provider-digest", types: ["providerDigest"] });
      const payloads = [first, second].map((job) => JSON.parse(job?.payloadJson ?? "{}"));
      expect(payloads.map((payload) => payload.notificationType).sort()).toEqual(["risk_trend", "weekly_digest"]);
      expect(payloads.flatMap((payload) => payload.subscriberEmails).sort()).toEqual(["risk@example.com", "weekly@example.com"]);
      expect(payloads[0].providerSlug).toBe("openrouter");
      expect(payloads[0].riskFlagCount).toBeGreaterThan(0);
      expect(third).toBeUndefined();
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
    }
  };
}
