import type { ProviderNodeRecord } from "@modeltruth/db";

export type WorkspaceTier = "free" | "pro" | "team";

export interface NodeSchedulePolicy {
  tier: WorkspaceTier;
  maxNodes: number;
  maxAlertChannels: number;
  heartbeatIntervalSeconds: number;
  deepAuditIntervalSeconds: number;
}

const policies: Record<WorkspaceTier, NodeSchedulePolicy> = {
  free: { tier: "free", maxNodes: 0, maxAlertChannels: 0, heartbeatIntervalSeconds: 0, deepAuditIntervalSeconds: 0 },
  pro: { tier: "pro", maxNodes: 3, maxAlertChannels: 2, heartbeatIntervalSeconds: 300, deepAuditIntervalSeconds: 43200 },
  team: { tier: "team", maxNodes: 10, maxAlertChannels: 10, heartbeatIntervalSeconds: 60, deepAuditIntervalSeconds: 21600 }
};

export function resolveNodeSchedulePolicy(tier: string | undefined): NodeSchedulePolicy {
  if (tier === "team") return policies.team;
  if (tier === "pro") return policies.pro;
  return policies.free;
}

export function validateNodeCreation(policy: NodeSchedulePolicy, existingNodes: ProviderNodeRecord[]) {
  if (policy.maxNodes === 0) throw new Error("Private node monitoring requires a Pro or Team subscription");
  if (existingNodes.length >= policy.maxNodes) {
    throw new Error(`${policy.tier} plan supports up to ${policy.maxNodes} active provider nodes`);
  }
}

export function validateAlertChannelCreation(policy: NodeSchedulePolicy, existingChannels: unknown[]) {
  if (policy.maxAlertChannels === 0) throw new Error("Alert channels require a Pro or Team subscription");
  if (existingChannels.length >= policy.maxAlertChannels) {
    throw new Error(`${policy.tier} plan supports up to ${policy.maxAlertChannels} active alert channels`);
  }
}

export function clampNodeSchedule(
  policy: NodeSchedulePolicy,
  input: { heartbeatIntervalSeconds?: unknown; deepAuditIntervalSeconds?: unknown }
) {
  return {
    heartbeatIntervalSeconds: Math.max(toPositiveInt(input.heartbeatIntervalSeconds, policy.heartbeatIntervalSeconds), policy.heartbeatIntervalSeconds),
    deepAuditIntervalSeconds: Math.max(toPositiveInt(input.deepAuditIntervalSeconds, policy.deepAuditIntervalSeconds), policy.deepAuditIntervalSeconds)
  };
}

function toPositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}
