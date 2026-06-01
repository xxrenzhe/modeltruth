import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, type MockInstance, vi } from "vitest";
import { createJobRepository, ensureSqliteReady } from "@modeltruth/db";
import { runWorkerTick } from "./index";

describe("worker audit logging", () => {
  it("writes complete redacted JSON-line audit fields for worker audits", async () => {
    const harness = await createHarness();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          workspaceId: "ws_log",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-worker-log-secret-123456",
          model: "gpt-5.1",
          suiteId: "smoke@1.0.0"
        }
      });
    } finally {
      await jobs.close();
    }
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "modeltruth-smoke-ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );

    await runWorkerTick();

    const auditLog = latestAuditLog(logSpy);
    harness.cleanup();
    vi.restoreAllMocks();

    expect(auditLog).toMatchObject({
      service: "worker",
      event: "audit.completed",
      workspaceId: "ws_log",
      nodeId: null,
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      providerHostHash: expect.any(String),
      latencyBreakdown: expect.any(Object),
      redactionApplied: true,
      runType: "deepAudit"
    });
    expect(auditLog.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(auditLog.runId).toEqual(expect.any(String));
    expect(JSON.stringify(auditLog)).not.toContain("sk-worker-log-secret");
  });
});

async function createHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-worker-audit-log-"));
  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  return {
    cleanup() {
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function latestAuditLog(logSpy: MockInstance<(message?: unknown, ...optionalParams: unknown[]) => void>) {
  const parsed = logSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    if (parsed[index].event === "audit.completed") return parsed[index];
  }
  throw new Error("missing audit.completed log");
}
