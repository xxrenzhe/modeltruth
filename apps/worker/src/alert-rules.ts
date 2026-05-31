import type { AuditRunListItem } from "@modeltruth/db";
import type { SmokeAuditResult } from "@modeltruth/audit-engine";

export interface AlertRuleInput {
  workspaceId: string;
  nodeId?: string;
  runId: string;
  runType: string;
  targetModelId: string;
  result: SmokeAuditResult;
  history: AuditRunListItem[];
  now?: Date;
  ttftThresholdMs?: number;
}

export interface AlertRuleMatch {
  rule: "uptime_5m" | "p95_ttft" | "deep_audit_consecutive_fail" | "billing_retest_variance";
  status: string;
  message: string;
}

export function evaluateAlertRules(input: AlertRuleInput): AlertRuleMatch[] {
  const now = input.now ?? new Date();
  const current = currentRun(input, now);
  const runs = [...input.history.filter((run) => run.runId !== input.runId), current].filter((run) => sameNode(run, input));
  return [
    uptimeRule(input, runs, now),
    ttftRule(input, runs, now),
    consecutiveDeepAuditFailRule(input, runs),
    billingRetestVarianceRule(input)
  ].filter((rule): rule is AlertRuleMatch => Boolean(rule));
}

function uptimeRule(input: AlertRuleInput, runs: AuditRunListItem[], now: Date): AlertRuleMatch | undefined {
  if (input.runType !== "heartbeat") return undefined;
  const recent = runs.filter((run) => run.runType === "heartbeat" && isWithin(run.createdAt, now, 5 * 60 * 1000));
  if (recent.length === 0) return undefined;
  const uptime = recent.filter((run) => run.status === "pass").length / recent.length;
  return uptime < 0.95
    ? { rule: "uptime_5m", status: "warning", message: `5m uptime ${(uptime * 100).toFixed(1)}% is below 95% for ${input.targetModelId}` }
    : undefined;
}

function ttftRule(input: AlertRuleInput, runs: AuditRunListItem[], now: Date): AlertRuleMatch | undefined {
  const recentTtft = runs
    .filter((run) => isWithin(run.createdAt, now, 5 * 60 * 1000))
    .map((run) => metricNumber(run.metrics, "ttftMs"))
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  if (recentTtft.length === 0) return undefined;
  const p95 = percentile(recentTtft, 0.95);
  const threshold = input.ttftThresholdMs ?? 3000;
  return p95 > threshold
    ? { rule: "p95_ttft", status: "warning", message: `P95 TTFT ${p95}ms exceeds ${threshold}ms for ${input.targetModelId}` }
    : undefined;
}

function consecutiveDeepAuditFailRule(input: AlertRuleInput, runs: AuditRunListItem[]): AlertRuleMatch | undefined {
  if (input.runType !== "deepAudit") return undefined;
  const latest = runs
    .filter((run) => run.runType === "deepAudit")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 2);
  return latest.length === 2 && latest.every((run) => run.status === "fail")
    ? { rule: "deep_audit_consecutive_fail", status: "fail", message: `2 consecutive deep audits failed for ${input.targetModelId}` }
    : undefined;
}

function billingRetestVarianceRule(input: AlertRuleInput): AlertRuleMatch | undefined {
  const billingVariance = input.result.evidenceSummary.billingVariance;
  if (!billingVariance || typeof billingVariance !== "object" || Array.isArray(billingVariance)) return undefined;
  const record = billingVariance as unknown as Record<string, unknown>;
  const ratio = typeof record.varianceRatio === "number" ? record.varianceRatio : 0;
  const retestOf = (input.result.evidenceSummary as Record<string, unknown>).retestOfRunId;
  const isRetest = Boolean(retestOf) || Boolean((input.result.evidenceSummary as Record<string, unknown>).billingRetest);
  if (!isRetest || ratio <= 0.05) return undefined;
  return {
    rule: "billing_retest_variance",
    status: ratio > 0.15 ? "fail" : "warning",
    message: `Billing variance ${(ratio * 100).toFixed(1)}% persisted after retest for ${input.targetModelId}`
  };
}

function currentRun(input: AlertRuleInput, now: Date): AuditRunListItem {
  return {
    runId: input.runId,
    workspaceId: input.workspaceId,
    nodeId: input.nodeId,
    suiteId: input.result.evidenceSummary.suiteId ?? input.result.evidenceSummary.suiteVersion ?? "unknown",
    runType: input.runType,
    targetModelId: input.targetModelId,
    status: input.result.overallStatus,
    confidence: input.result.confidence,
    metrics: input.result.metrics,
    evidenceSummary: input.result.evidenceSummary,
    createdAt: now.toISOString()
  };
}

function sameNode(run: AuditRunListItem, input: AlertRuleInput) {
  if (input.nodeId) return run.nodeId === input.nodeId;
  return run.workspaceId === input.workspaceId && run.targetModelId === input.targetModelId;
}

function isWithin(createdAt: string, now: Date, windowMs: number) {
  return new Date(createdAt).getTime() >= now.getTime() - windowMs;
}

function metricNumber(metrics: unknown, key: string): number | undefined {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return undefined;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function percentile(values: number[], ratio: number) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index] ?? 0;
}
