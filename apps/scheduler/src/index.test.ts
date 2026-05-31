import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAuthRepository,
  createJobRepository,
  createModelRegistryRepository,
  createProviderNodeRepository,
  ensureSqliteReady
} from "@modeltruth/db";
import { runSchedulerTick } from "./index";

describe("runSchedulerTick calibration scheduling", () => {
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
      expect(JSON.parse(deepAudit?.payloadJson ?? "{}").fingerprint).toMatch(/^deepAudit:/);
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
