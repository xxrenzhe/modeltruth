import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createRiskFlagRepository } from "./risk-flags";

describe("RiskFlagRepository", () => {
  it("deduplicates risk flags, appends evidence and enforces the state machine", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-risk-flags-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createRiskFlagRepository();
    const first = await repo.upsertActive({
      workspaceId: "ws_1",
      nodeId: "node_1",
      providerSlug: "openrouter",
      assertionId: "HTTP_STATUS_OK",
      severity: "warning",
      runId: "run_1",
      targetModelId: "router-model",
      suiteId: "smoke",
      redactedSummary: { responseMetadata: { status: 500 }, apiKey: undefined },
      observedAt: "2026-05-31T00:00:00.000Z"
    });
    const second = await repo.upsertActive({
      workspaceId: "ws_1",
      nodeId: "node_1",
      providerSlug: "openrouter",
      assertionId: "HTTP_STATUS_OK",
      severity: "warning",
      runId: "run_2",
      targetModelId: "router-model",
      suiteId: "smoke",
      redactedSummary: { responseMetadata: { status: 502 } },
      observedAt: "2026-05-31T01:00:00.000Z"
    });
    const acknowledged = await repo.transition(first.id, "acknowledged", "operator", "triaged");
    const resolved = await repo.transition(first.id, "resolved", "operator", "provider recovered");
    const separate = await repo.upsertActive({
      workspaceId: "ws_1",
      nodeId: "node_1",
      providerSlug: "openrouter",
      assertionId: "HTTP_STATUS_OK",
      severity: "warning",
      runId: "run_3",
      redactedSummary: { responseMetadata: { status: 500 } },
      observedAt: "2026-06-01T03:00:00.000Z"
    });
    const events = await repo.listEvents(first.id);
    const evidence = await repo.listEvidence(first.id);
    await expect(repo.transition(resolved.id, "active")).rejects.toThrow("Invalid risk flag transition");
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(second.id).toBe(first.id);
    expect(second.evidenceCount).toBe(2);
    expect(acknowledged.status).toBe("acknowledged");
    expect(resolved.status).toBe("resolved");
    expect(separate.id).not.toBe(first.id);
    expect(events.map((event) => event.eventType)).toEqual(["created", "evidence_added", "acknowledged", "resolved"]);
    expect(events.find((event) => event.eventType === "acknowledged")).toMatchObject({
      fromStatus: "active",
      toStatus: "acknowledged",
      actor: "operator"
    });
    expect(evidence.map((item) => item.runId)).toEqual(["run_1", "run_2"]);
    expect(evidence[0].redactedSummary).toMatchObject({ responseMetadata: { status: 500 } });
  });
});
