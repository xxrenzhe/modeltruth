export type AuditStatus = "pass" | "warning" | "fail" | "inconclusive" | "error";

export interface AuditMetricSummary {
  ttftMs?: number;
  totalLatencyMs?: number;
  statusCode?: number;
}
