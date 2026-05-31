import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { buildMonthlyAuditReport, parseReportMonth } from "./audit-reports";
import { saveAuditRun } from "./audit-runs";

describe("monthly audit reports", () => {
  it("builds subscriber export summaries for one UTC month", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-monthly-report-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    await seedReportRun("run_pass", "ws_report", "2026-05-05T10:00:00.000Z", "pass", "openai", 100);
    await seedReportRun("run_warning", "ws_report", "2026-05-15T10:00:00.000Z", "warning", "openai", 300);
    await seedReportRun("run_fail", "ws_report", "2026-05-20T10:00:00.000Z", "fail", "anthropic", 500);
    await seedReportRun("run_other_month", "ws_report", "2026-04-30T23:59:59.000Z", "pass", "openai", 900);
    await seedReportRun("run_other_workspace", "ws_other", "2026-05-10T10:00:00.000Z", "pass", "openrouter", 700);

    const report = await buildMonthlyAuditReport({
      workspaceId: "ws_report",
      month: "2026-05",
      generatedAt: new Date("2026-05-31T00:00:00.000Z")
    });

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(report.schemaVersion).toBe("modeltruth.monthly-audit-report.v1");
    expect(report.generatedAt).toBe("2026-05-31T00:00:00.000Z");
    expect(report.totals).toMatchObject({ totalRuns: 3, passRate: 1 / 3, warningRate: 1 / 3, failureRate: 1 / 3 });
    expect(report.totals.p50TtftMs).toBe(300);
    expect(report.totals.p95TtftMs).toBe(500);
    expect(report.providers.map((provider) => provider.key)).toEqual(["anthropic", "openai"]);
    expect(report.suites.map((suite) => suite.key)).toEqual(["smoke@heartbeat"]);
    expect(report.runs.map((run) => run.runId)).toEqual(["run_fail", "run_warning", "run_pass"]);
    expect(report.retention).toEqual({ rawEvidenceDays: 30, aggregateMetricsDays: 365 });
  });

  it("rejects non YYYY-MM report months", () => {
    expect(() => parseReportMonth("2026-5")).toThrow("month must use YYYY-MM format");
    expect(() => parseReportMonth("2026-13")).toThrow("month must use YYYY-MM format");
  });
});

async function seedReportRun(
  id: string,
  workspaceId: string,
  createdAt: string,
  status: string,
  providerSlug: string,
  ttftMs: number
) {
  await saveAuditRun({
    id,
    workspaceId,
    providerSlug,
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType: "heartbeat",
    targetModelId: "gpt-5.1",
    status,
    confidence: status === "pass" ? 0.9 : 0.7,
    createdAt,
    metrics: { ttftMs, statusCode: 200 },
    assertions: [{ id: "HTTP_STATUS_OK", status }],
    evidenceSummary: { requestBodyStored: false }
  });
}
