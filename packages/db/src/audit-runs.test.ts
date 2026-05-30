import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { getEvidencePackage, getPublicAuditSummary, listAuditRuns, saveAuditRun } from "./audit-runs";

describe("audit run evidence persistence", () => {
  it("stores redacted evidence packages for export", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-evidence-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    await saveAuditRun({
      id: "run_test",
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
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      status: "warning",
      confidence: 0.6,
      metrics: { ttftMs: 900, statusCode: 200 },
      assertions: [{ id: "USAGE_PRESENT", status: "inconclusive" }],
      evidenceSummary: { requestBodyStored: false }
    });
    const runs = await listAuditRuns();
    const summary = await getPublicAuditSummary();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(evidence?.runId).toBe("run_test");
    expect(evidence?.metrics).toEqual({ statusCode: 200 });
    expect(JSON.stringify(evidence)).not.toContain("sk-");
    expect(runs.map((run) => run.runId)).toContain("run_warning");
    expect(summary.totalRuns).toBe(2);
    expect(summary.passRate).toBe(0.5);
    expect(summary.riskFlags[0].runId).toBe("run_warning");
  });
});
