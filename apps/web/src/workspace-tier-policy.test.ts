import { describe, expect, it } from "vitest";
import type { ProviderNodeRecord } from "@modeltruth/db";
import { clampNodeSchedule, resolveNodeSchedulePolicy, validateAlertChannelCreation, validateNodeCreation } from "./lib/workspace-tier-policy";

describe("workspace tier node policy", () => {
  it("blocks private nodes for free workspaces", () => {
    const policy = resolveNodeSchedulePolicy("free");

    expect(() => validateNodeCreation(policy, [])).toThrow("requires a Pro or Team subscription");
    expect(() => validateAlertChannelCreation(policy, [])).toThrow("Alert channels require a Pro or Team subscription");
  });

  it("enforces Pro node cap and minimum audit intervals", () => {
    const policy = resolveNodeSchedulePolicy("pro");
    const nodes = Array.from({ length: 3 }, (_, index) => node(`node_${index}`));
    const schedule = clampNodeSchedule(policy, { heartbeatIntervalSeconds: 60, deepAuditIntervalSeconds: 3600 });

    expect(() => validateNodeCreation(policy, nodes)).toThrow("pro plan supports up to 3 active provider nodes");
    expect(() => validateAlertChannelCreation(policy, [{}, {}])).toThrow("pro plan supports up to 2 active alert channels");
    expect(schedule).toEqual({ heartbeatIntervalSeconds: 300, deepAuditIntervalSeconds: 43200 });
  });

  it("allows Team capacity and clamps to Team minimum intervals", () => {
    const policy = resolveNodeSchedulePolicy("team");
    const nodes = Array.from({ length: 9 }, (_, index) => node(`node_${index}`));
    const schedule = clampNodeSchedule(policy, { heartbeatIntervalSeconds: 10, deepAuditIntervalSeconds: 3600 });

    expect(() => validateNodeCreation(policy, nodes)).not.toThrow();
    expect(() => validateAlertChannelCreation(policy, Array.from({ length: 9 }))).not.toThrow();
    expect(schedule).toEqual({ heartbeatIntervalSeconds: 60, deepAuditIntervalSeconds: 21600 });
  });
});

function node(id: string): ProviderNodeRecord {
  return {
    id,
    workspaceId: "workspace",
    name: id,
    baseUrl: "https://api.example.com/v1",
    baseUrlHostHash: "hash",
    modelId: "gpt-5.1",
    status: "active",
    heartbeatIntervalSeconds: 300,
    deepAuditIntervalSeconds: 43200,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}
