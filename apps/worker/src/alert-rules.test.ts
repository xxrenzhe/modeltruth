import { describe, expect, it } from "vitest";
import { evaluateAlertRules } from "./alert-rules";

const now = new Date("2026-05-31T00:00:00.000Z");

describe("evaluateAlertRules", () => {
  it("triggers when 5 minute uptime drops below 95 percent", () => {
    const rules = evaluateAlertRules({
      workspaceId: "ws_1",
      nodeId: "node_1",
      runId: "run_current",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      result: result("fail", { statusCode: 500 }),
      history: [run("run_old_pass", "heartbeat", "pass", { statusCode: 200 })],
      now
    });

    expect(rules.map((rule) => rule.rule)).toContain("uptime_5m");
  });

  it("triggers when 5 minute P95 TTFT exceeds the default threshold", () => {
    const rules = evaluateAlertRules({
      workspaceId: "ws_1",
      nodeId: "node_1",
      runId: "run_current",
      runType: "heartbeat",
      targetModelId: "gpt-5.1",
      result: result("pass", { statusCode: 200, ttftMs: 3500 }),
      history: [run("run_fast", "heartbeat", "pass", { statusCode: 200, ttftMs: 200 })],
      now
    });

    expect(rules.map((rule) => rule.rule)).toContain("p95_ttft");
  });

  it("triggers after two consecutive deep audit failures", () => {
    const rules = evaluateAlertRules({
      workspaceId: "ws_1",
      nodeId: "node_1",
      runId: "run_current",
      runType: "deepAudit",
      targetModelId: "gpt-5.1",
      result: result("fail", { statusCode: 200 }),
      history: [run("run_previous", "deepAudit", "fail", { statusCode: 200 })],
      now
    });

    expect(rules).toContainEqual(expect.objectContaining({ rule: "deep_audit_consecutive_fail", status: "fail" }));
  });

  it("triggers billing variance only when a retest remains above 5 percent", () => {
    const initial = evaluateAlertRules({
      workspaceId: "ws_1",
      nodeId: "node_1",
      runId: "run_initial",
      runType: "deepAudit",
      targetModelId: "gpt-5.1",
      result: result("fail", { statusCode: 200 }, { billingVariance: { varianceRatio: 0.2, retestRequired: true } }),
      history: [],
      now
    });
    const retest = evaluateAlertRules({
      workspaceId: "ws_1",
      nodeId: "node_1",
      runId: "run_retest",
      runType: "deepAudit",
      targetModelId: "gpt-5.1",
      result: result("warning", { statusCode: 200 }, { billingVariance: { varianceRatio: 0.06 }, billingRetest: true }),
      history: [],
      now
    });

    expect(initial.map((rule) => rule.rule)).not.toContain("billing_retest_variance");
    expect(retest).toContainEqual(expect.objectContaining({ rule: "billing_retest_variance", status: "warning" }));
  });
});

function result(status: "pass" | "warning" | "fail", metrics: Record<string, unknown>, evidenceSummary: Record<string, unknown> = {}) {
  return {
    runId: crypto.randomUUID(),
    traceId: "1234567890abcdef1234567890abcdef",
    overallStatus: status,
    confidence: 0.9,
    metrics,
    assertions: [],
    evidenceSummary: { redaction: "applied" as const, requestBodyStored: false as const, suiteId: "smoke" as const, ...evidenceSummary }
  };
}

function run(runId: string, runType: string, status: string, metrics: Record<string, unknown>) {
  return {
    runId,
    workspaceId: "ws_1",
    nodeId: "node_1",
    suiteId: "smoke",
    runType,
    targetModelId: "gpt-5.1",
    status,
    confidence: 0.8,
    metrics,
    evidenceSummary: {},
    createdAt: new Date(now.getTime() - 60_000).toISOString()
  };
}
