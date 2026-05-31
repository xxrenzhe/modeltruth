import type { AuditStatus } from "@modeltruth/shared";

export interface BillingSnapshot {
  expectedCostUsd: number;
  balanceBeforeUsd: number;
  balanceAfterUsd: number;
}

export interface BillingVarianceResult {
  expectedCostUsd: number;
  actualCostUsd: number;
  varianceRatio: number;
  direction: "overcharged" | "undercharged" | "matched";
  status: AuditStatus;
  retestRequired: boolean;
}

export function evaluateBillingVariance(snapshot: BillingSnapshot | undefined): BillingVarianceResult | undefined {
  if (!snapshot || snapshot.expectedCostUsd <= 0) return undefined;
  const actualCostUsd = roundCurrency(snapshot.balanceBeforeUsd - snapshot.balanceAfterUsd);
  const expectedCostUsd = roundCurrency(snapshot.expectedCostUsd);
  const varianceRatio = roundRatio(Math.abs(actualCostUsd - expectedCostUsd) / expectedCostUsd);
  const status = varianceRatio > 0.15 ? "fail" : varianceRatio >= 0.05 ? "warning" : "pass";
  return {
    expectedCostUsd,
    actualCostUsd,
    varianceRatio,
    direction: actualCostUsd > expectedCostUsd ? "overcharged" : actualCostUsd < expectedCostUsd ? "undercharged" : "matched",
    status,
    retestRequired: status === "fail"
  };
}

function roundCurrency(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundRatio(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
