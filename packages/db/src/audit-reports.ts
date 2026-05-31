import { listAuditRuns, type AuditRunListItem } from "./audit-runs";

export interface MonthlyAuditReport {
  schemaVersion: "modeltruth.monthly-audit-report.v1";
  generatedAt: string;
  month: string;
  workspaceId: string;
  totals: {
    totalRuns: number;
    passRate: number;
    warningRate: number;
    failureRate: number;
    p50TtftMs?: number;
    p95TtftMs?: number;
  };
  providers: MonthlyReportGroup[];
  suites: MonthlyReportGroup[];
  runs: AuditRunListItem[];
  retention: {
    rawEvidenceDays: number;
    aggregateMetricsDays: number;
  };
}

export interface MonthlyReportGroup {
  key: string;
  totalRuns: number;
  passRate: number;
  warningRate: number;
  failureRate: number;
}

export async function buildMonthlyAuditReport(input: {
  workspaceId: string;
  month: string;
  generatedAt?: Date;
}): Promise<MonthlyAuditReport> {
  const month = parseReportMonth(input.month);
  const runs = (await listAuditRuns({ workspaceId: input.workspaceId, limit: 5000 })).filter((run) => {
    const createdAt = new Date(run.createdAt);
    return createdAt >= month.start && createdAt < month.end;
  });

  return {
    schemaVersion: "modeltruth.monthly-audit-report.v1",
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    month: input.month,
    workspaceId: input.workspaceId,
    totals: summarizeRuns(runs),
    providers: summarizeGroups(runs, (run) => run.providerSlug ?? "custom"),
    suites: summarizeGroups(runs, (run) => `${run.suiteId}@${run.runType}`),
    runs,
    retention: {
      rawEvidenceDays: 30,
      aggregateMetricsDays: 365
    }
  };
}

export function parseReportMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("month must use YYYY-MM format");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}

function summarizeGroups(runs: AuditRunListItem[], keyFor: (run: AuditRunListItem) => string) {
  const keys = [...new Set(runs.map(keyFor))].sort();
  return keys.map((key) => ({ key, ...summarizeStatus(runs.filter((run) => keyFor(run) === key)) }));
}

function summarizeRuns(runs: AuditRunListItem[]) {
  const ttfts = runs
    .map((run) => metricNumber(run.metrics, "ttftMs"))
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  return {
    ...summarizeStatus(runs),
    p50TtftMs: percentile(ttfts, 0.5),
    p95TtftMs: percentile(ttfts, 0.95)
  };
}

function summarizeStatus(runs: AuditRunListItem[]) {
  const totalRuns = runs.length;
  const passCount = runs.filter((run) => run.status === "pass").length;
  const warningCount = runs.filter((run) => run.status === "warning").length;
  const failureCount = runs.filter((run) => ["fail", "error"].includes(run.status)).length;
  return {
    totalRuns,
    passRate: totalRuns ? passCount / totalRuns : 0,
    warningRate: totalRuns ? warningCount / totalRuns : 0,
    failureRate: totalRuns ? failureCount / totalRuns : 0
  };
}

function metricNumber(metrics: unknown, key: string): number | undefined {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return undefined;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}
