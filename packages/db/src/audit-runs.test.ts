import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { applyAuditRetentionPolicy, getEvidencePackage, getPublicAuditSummary, listAuditRuns, saveAuditRun } from "./audit-runs";
import { createRiskFlagRepository } from "./risk-flags";

describe("audit run evidence persistence", () => {
  it("stores redacted evidence packages for export", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-evidence-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    await saveAuditRun({
      id: "run_test",
      traceId: "1234567890abcdef1234567890abcdef",
      providerSlug: "openai",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "playground",
      targetModelId: "gpt-5.1",
      status: "pass",
      confidence: 0.9,
      metrics: { statusCode: 200 },
      assertions: [{ id: "HTTP_STATUS_OK", status: "pass" }],
      evidenceSummary: { requestBodyStored: false, completionHash: "abc" }
    });
    const evidence = await getEvidencePackage("run_test");
    await saveAuditRun({
      id: "run_warning",
      providerSlug: "openai",
      workspaceId: "ws_private",
      nodeId: "node_private",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      status: "warning",
      confidence: 0.6,
      metrics: { ttftMs: 900, statusCode: 200 },
      assertions: [{ id: "USAGE_PRESENT", status: "inconclusive" }],
      evidenceSummary: {
        requestBodyStored: false,
        fullResponse: "private completion",
        responseExcerpt: "private excerpt",
        apiKey: "sk-public-summary-leak",
        requestMetadata: {
          method: "POST",
          targetHostHash: "host_hash",
          model: "gpt-5.1",
          headers: ["authorization: Bearer sk-public-summary-leak", "content-type"]
        },
        responseMetadata: {
          status: 200,
          headers: { "content-type": "application/json", "set-cookie": "session=secret" },
          usage: { total_tokens: 12, rawPrompt: "private prompt" }
        },
        openInference: { "modeltruth.suite_id": "smoke", apiKey: "sk-public-summary-leak" }
      }
    });
    await saveAuditRun({
      id: "run_warning_retest",
      providerSlug: "openai",
      workspaceId: "ws_private",
      nodeId: "node_private",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      status: "warning",
      confidence: 0.62,
      metrics: { ttftMs: 880, statusCode: 200 },
      assertions: [{ id: "USAGE_PRESENT", status: "inconclusive" }],
      evidenceSummary: { requestBodyStored: false, retestOf: "run_warning" }
    });
    await saveAuditRun({
      id: "run_single_warning",
      providerSlug: "openrouter",
      suiteId: "context-lite",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "router-model",
      status: "warning",
      confidence: 0.7,
      metrics: { ttftMs: 1200, statusCode: 200 },
      assertions: [{ id: "CONTEXT_NEEDLE_RETRIEVAL", status: "warning" }],
      evidenceSummary: { requestBodyStored: false }
    });
    await saveAuditRun({
      id: "run_high_confidence_warning",
      providerSlug: "openai",
      suiteId: "context-lite",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      status: "warning",
      confidence: 0.92,
      metrics: { ttftMs: 920, statusCode: 200 },
      assertions: [{ id: "CONTEXT_NEEDLE_RETRIEVAL", status: "warning" }],
      evidenceSummary: { requestBodyStored: false }
    });
    await saveAuditRun({
      id: "run_high_confidence_pass_retest",
      providerSlug: "openai",
      suiteId: "context-lite",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      status: "pass",
      confidence: 0.9,
      metrics: { ttftMs: 870, statusCode: 200 },
      assertions: [{ id: "CONTEXT_NEEDLE_RETRIEVAL", status: "pass" }],
      evidenceSummary: { requestBodyStored: false, retestOf: "run_high_confidence_warning" }
    });
    await saveAuditRun({
      id: "run_old",
      providerSlug: "anthropic",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "claude",
      status: "pass",
      confidence: 0.8,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      metrics: { ttftMs: 500, statusCode: 200 },
      assertions: [{ id: "HTTP_STATUS_OK", status: "pass" }],
      evidenceSummary: { requestBodyStored: false }
    });
    const runs = await listAuditRuns();
    const summary = await getPublicAuditSummary();
    const openaiSummary = await getPublicAuditSummary({ providerSlug: "openai" });
    const riskFlags = await createRiskFlagRepository();
    const persistedFlags = await riskFlags.listByProvider("openai", ["active"]);
    const persistedEvidence = await riskFlags.listEvidence(persistedFlags[0].id);
    await riskFlags.transition(persistedFlags[0].id, "resolved", "operator", "false positive cleared");
    const resolvedSummary = await getPublicAuditSummary({ providerSlug: "openai" });
    await riskFlags.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(evidence?.runId).toBe("run_test");
    expect(evidence?.traceId).toBe("1234567890abcdef1234567890abcdef");
    expect(evidence?.providerSlug).toBe("openai");
    expect(evidence?.metrics).toEqual({ statusCode: 200 });
    expect(JSON.stringify(evidence)).not.toContain("sk-");
    expect(runs.map((run) => run.runId)).toContain("run_warning");
    expect(runs.find((run) => run.runId === "run_test")?.traceId).toBe("1234567890abcdef1234567890abcdef");
    expect(summary.totalRuns).toBe(7);
    expect(summary.windows["24h"].totalRuns).toBe(6);
    expect(summary.windows["7d"].totalRuns).toBe(6);
    expect(summary.windows["30d"].totalRuns).toBe(7);
    expect(summary.isFresh).toBe(true);
    expect(summary.dataFreshnessSeconds).toBeLessThanOrEqual(600);
    expect(summary.lastRunAt).toBeTruthy();
    expect(summary.providers.map((provider) => provider.providerSlug)).toEqual(["anthropic", "openai", "openrouter"]);
    expect(summary.evidenceScore).toBeGreaterThan(0);
    expect(summary.providers.find((provider) => provider.providerSlug === "openai")?.evidenceScore).toBeGreaterThan(0);
    expect(summary.providers.find((provider) => provider.providerSlug === "openai")?.isFresh).toBe(true);
    expect(openaiSummary.totalRuns).toBe(5);
    expect(openaiSummary.isFresh).toBe(true);
    expect(openaiSummary.passRate).toBe(2 / 5);
    expect(persistedFlags).toHaveLength(1);
    expect(persistedFlags[0]).toMatchObject({ providerSlug: "openai", assertionId: "OVERALL_STATUS", evidenceCount: 2 });
    expect(persistedEvidence.map((item) => item.runId)).toEqual(["run_warning", "run_warning_retest"]);
    expect(JSON.stringify(persistedEvidence)).not.toContain("sk-public-summary-leak");
    expect(summary.riskFlags.map((run) => run.runId)).toEqual(expect.arrayContaining(["run_warning", "run_warning_retest"]));
    expect(summary.riskFlags.map((run) => run.runId)).not.toContain("run_single_warning");
    expect(summary.riskFlags.map((run) => run.runId)).not.toContain("run_high_confidence_warning");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("ws_private");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("node_private");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("authorization");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("set-cookie");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("rawPrompt");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("total_tokens");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("sk-public-summary-leak");
    expect(summary.riskFlags.find((run) => run.runId === "run_warning")?.evidenceSummary).toMatchObject({ requestBodyStored: false });
    expect(summary.riskFlags.find((run) => run.runId === "run_warning")?.evidenceSummary).toMatchObject({
      responseMetadata: { usage: { totalTokens: 12 } }
    });
    expect(resolvedSummary.riskFlags).toHaveLength(0);
    expect(JSON.stringify(summary.riskFlags)).not.toContain("private completion");
    expect(JSON.stringify(summary.riskFlags)).not.toContain("private excerpt");
  });

  it("applies legal retention windows for playground, private evidence and aggregate metrics", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-retention-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
    const now = new Date("2026-05-31T00:00:00.000Z");

    await seedRun("expired_playground", "playground", new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString());
    await seedRun("fresh_playground", "playground", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString());
    await seedRun("expired_private", "heartbeat", new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(), "ws_1");
    await seedRun("expired_aggregate", "heartbeat", new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000).toISOString(), "ws_1");

    const result = await applyAuditRetentionPolicy({ now });
    const expiredPlayground = await getEvidencePackage("expired_playground");
    const freshPlayground = await getEvidencePackage("fresh_playground");
    const expiredPrivate = await getEvidencePackage("expired_private");
    const expiredAggregate = await getEvidencePackage("expired_aggregate");

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(result).toEqual({
      deletedAggregateRuns: 1,
      deletedFreePlaygroundRuns: 1,
      redactedPrivateEvidenceRuns: 1
    });
    expect(expiredPlayground).toBeUndefined();
    expect(freshPlayground?.assertions).toEqual([{ id: "RAW_CHECK", status: "pass", prompt: "redacted prompt" }]);
    expect(expiredPrivate?.assertions).toEqual([]);
    expect(expiredPrivate?.metrics).toEqual({ ttftMs: 100, statusCode: 200 });
    expect(expiredPrivate?.evidenceSummary).toMatchObject({ retentionRedacted: true });
    expect(expiredAggregate).toBeUndefined();
  });
});

async function seedRun(id: string, runType: string, createdAt: string, workspaceId?: string) {
  await saveAuditRun({
    id,
    workspaceId,
    providerSlug: "openai",
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType,
    targetModelId: "gpt-5.1",
    status: "pass",
    confidence: 0.9,
    createdAt,
    metrics: { ttftMs: 100, statusCode: 200 },
    assertions: [{ id: "RAW_CHECK", status: "pass", prompt: "redacted prompt" }],
    evidenceSummary: { requestBodyStored: false, completionHash: `${id}_hash` }
  });
}
