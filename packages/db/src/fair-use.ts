import { createBillingRepository } from "./billing";
import { listAuditRuns } from "./audit-runs";

export type FairUseAction = "allow" | "downshift" | "upgrade_prompt";

export interface WorkspaceFairUseStatus {
  workspaceId: string;
  tier: string;
  monthlyRevenueUsd: number;
  budgetUsd: number;
  currentMonthCostUsd: number;
  costRatio: number;
  action: FairUseAction;
  reason?: string;
  recommendedDeepAuditDelayMs?: number;
}

const fairUseBudgetRatio = 0.4;
const oneDayMs = 24 * 60 * 60 * 1000;
const monthlyRevenueByTier: Record<string, number> = {
  pro: 19,
  team: 79
};

export async function getWorkspaceFairUseStatus(workspaceId: string, now = new Date()): Promise<WorkspaceFairUseStatus> {
  const billing = await createBillingRepository();
  try {
    const workspace = await billing.getWorkspaceBilling(workspaceId);
    const tier = workspace?.tier ?? "free";
    const monthlyRevenueUsd = monthlyRevenueByTier[tier] ?? 0;
    const budgetUsd = roundMoney(monthlyRevenueUsd * fairUseBudgetRatio);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const runs = await listAuditRuns({ workspaceId, limit: 5000 });
    const currentMonthCostUsd = roundMoney(
      runs
        .filter((run) => new Date(run.createdAt) >= monthStart)
        .reduce((sum, run) => sum + costEstimateUsd(run.metrics), 0)
    );
    const costRatio = budgetUsd > 0 ? currentMonthCostUsd / budgetUsd : currentMonthCostUsd > 0 ? Number.POSITIVE_INFINITY : 0;
    const exceeded = budgetUsd === 0 ? currentMonthCostUsd > 0 : currentMonthCostUsd > budgetUsd;
    return {
      workspaceId,
      tier,
      monthlyRevenueUsd,
      budgetUsd,
      currentMonthCostUsd,
      costRatio,
      action: exceeded ? (monthlyRevenueUsd > 0 ? "downshift" : "upgrade_prompt") : "allow",
      reason: exceeded ? "monthly_audit_cost_exceeded_40_percent_of_plan_revenue" : undefined,
      recommendedDeepAuditDelayMs: exceeded ? oneDayMs : undefined
    };
  } finally {
    await billing.close();
  }
}

function costEstimateUsd(value: unknown): number {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  const cost = record?.costEstimate;
  const costRecord = cost && typeof cost === "object" && !Array.isArray(cost) ? (cost as Record<string, unknown>) : undefined;
  const total = costRecord?.totalCostUsd;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
