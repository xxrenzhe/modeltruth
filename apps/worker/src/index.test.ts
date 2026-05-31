import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthRepository,
  createJobRepository,
  createModelRegistryRepository,
  createProviderDisputeRepository,
  createWorkspacePrivacyRepository,
  ensureSqliteReady,
  getEvidencePackage,
  listAuditRuns,
  saveAuditRun
} from "@modeltruth/db";
import { runWorkerTick } from "./index";
describe("runWorkerTick calibration jobs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs scheduled calibration against configured official endpoint and records history", async () => {
    const harness = await createHarness("modeltruth-worker-calibration-");
    const previousBaseUrl = process.env.MODELTRUTH_CALIBRATION_OPENAI_BASE_URL;
    const previousApiKey = process.env.MODELTRUTH_CALIBRATION_OPENAI_API_KEY;
    process.env.MODELTRUTH_CALIBRATION_OPENAI_BASE_URL = "https://api.openai.example.com/v1";
    process.env.MODELTRUTH_CALIBRATION_OPENAI_API_KEY = "sk-calibration";

    const registry = await createModelRegistryRepository();
    try {
      await registry.upsert({
        provider: "openai",
        modelId: "gpt-5.1",
        family: "gpt-5",
        status: "experimental",
        supportsReasoningUsage: true,
        supportsStreaming: true
      });
    } finally {
      await registry.close();
    }

    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "calibration",
        payload: {
          fingerprint: "calibration:openai:gpt-5.1:fingerprint-calibration@1.0.0",
          provider: "openai",
          modelId: "gpt-5.1",
          suiteId: "fingerprint-calibration@1.0.0"
        }
      });
    } finally {
      await jobs.close();
    }

    const calls: Array<{ url: string; authorization?: string }> = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), authorization: (init?.headers as Record<string, string>)?.authorization });
      return new Response(
        JSON.stringify({
          model: "gpt-5.1",
          choices: [{ message: { content: "modeltruth-smoke-ok" } }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    await runWorkerTick();

    const refreshed = await createModelRegistryRepository();
    try {
      const model = await refreshed.get("openai", "gpt-5.1");
      expect(model?.lastCalibratedAt).toBeTruthy();
    } finally {
      await refreshed.close();
      if (previousBaseUrl === undefined) delete process.env.MODELTRUTH_CALIBRATION_OPENAI_BASE_URL;
      else process.env.MODELTRUTH_CALIBRATION_OPENAI_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.MODELTRUTH_CALIBRATION_OPENAI_API_KEY;
      else process.env.MODELTRUTH_CALIBRATION_OPENAI_API_KEY = previousApiKey;
      harness.cleanup();
    }

    expect(calls[0]).toMatchObject({
      url: "https://api.openai.example.com/v1/chat/completions",
      authorization: "Bearer sk-calibration"
    });
  });

  it("enqueues one automatic retest when billing-lite variance exceeds 15 percent", async () => {
    const harness = await createHarness("modeltruth-worker-billing-retest-");
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-worker-test",
          model: "gpt-5.1",
          suiteId: "billing-lite@1.0.0",
          billingSnapshot: {
            expectedCostUsd: 1,
            balanceBeforeUsd: 10,
            balanceAfterUsd: 8.8
          }
        }
      });
    } finally {
      await jobs.close();
    }

    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            model: "gpt-5.1",
            choices: [{ message: { content: "billing ok" } }],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    await runWorkerTick();

    const refreshed = await createJobRepository();
    try {
      const retest = await refreshed.claimNext({ workerId: "test", types: ["deepAudit"] });
      const payload = JSON.parse(retest?.payloadJson ?? "{}") as Record<string, unknown>;
      expect(retest?.type).toBe("deepAudit");
      expect(payload).toMatchObject({
        suiteId: "billing-lite@1.0.0",
        billingRetest: true
      });
      expect(payload.retestOfRunId).toEqual(expect.any(String));
    } finally {
      await refreshed.close();
      harness.cleanup();
    }
  });

  it("alerts when billing variance remains above 5 percent on retest", async () => {
    const harness = await createHarness("modeltruth-worker-billing-alert-");
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          workspaceId: "ws_billing",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-worker-test",
          model: "gpt-5.1",
          suiteId: "billing-lite@1.0.0",
          retestOfRunId: "run_initial_billing",
          billingRetest: true,
          billingSnapshot: {
            expectedCostUsd: 1,
            balanceBeforeUsd: 10,
            balanceAfterUsd: 8.94
          }
        }
      });
    } finally {
      await jobs.close();
    }
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "billing retest ok" } }],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    await runWorkerTick();

    const refreshed = await createJobRepository();
    try {
      const alert = await refreshed.claimNext({ workerId: "test", types: ["alert"] });
      const payload = JSON.parse(alert?.payloadJson ?? "{}") as Record<string, unknown>;
      expect(alert?.type).toBe("alert");
      expect(payload.rule).toBe("billing_retest_variance");
      expect(payload.status).toBe("warning");
    } finally {
      await refreshed.close();
      harness.cleanup();
    }
  });

  it("does not alert on a single deep audit failure", async () => {
    const harness = await createHarness("modeltruth-worker-single-fail-no-alert-");
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          workspaceId: "ws_alert",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-worker-test",
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
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
    );

    await runWorkerTick();

    const refreshed = await createJobRepository();
    try {
      const alert = await refreshed.claimNext({ workerId: "test", types: ["alert"] });
      expect(alert).toBeUndefined();
    } finally {
      await refreshed.close();
      harness.cleanup();
    }
  });

  it("alerts on the second consecutive deep audit failure", async () => {
    const harness = await createHarness("modeltruth-worker-alert-rules-");
    await seedPreviousDeepAuditFail("previous_fail");
    const jobs = await createJobRepository();
    try {
      await enqueueFailingDeepAudit(jobs);
    } finally {
      await jobs.close();
    }
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
    );

    await runWorkerTick();

    const refreshed = await createJobRepository();
    try {
      const alert = await refreshed.claimNext({ workerId: "test", types: ["alert"] });
      const payload = JSON.parse(alert?.payloadJson ?? "{}") as Record<string, unknown>;
      expect(alert?.type).toBe("alert");
      expect(payload.rule).toBe("deep_audit_consecutive_fail");
      expect(payload.status).toBe("fail");
      expect(payload.fingerprint).toBe("alert:ws_alert:workspace:deep_audit_consecutive_fail:fail");
    } finally {
      await refreshed.close();
      harness.cleanup();
    }
  });

  it("deduplicates matching alert jobs for 24 hours", async () => {
    const harness = await createHarness("modeltruth-worker-alert-dedupe-");
    await seedPreviousDeepAuditFail("previous_fail_dedupe");
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "alert",
        payload: { fingerprint: "alert:ws_alert:workspace:deep_audit_consecutive_fail:fail" }
      });
      await enqueueFailingDeepAudit(jobs);
    } finally {
      await jobs.close();
    }
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
    );

    await runWorkerTick();

    const refreshed = await createJobRepository();
    try {
      const firstAlert = await refreshed.claimNext({ workerId: "test", types: ["alert"] });
      const secondAlert = await refreshed.claimNext({ workerId: "test", types: ["alert"] });
      expect(firstAlert?.type).toBe("alert");
      expect(secondAlert).toBeUndefined();
    } finally {
      await refreshed.close();
      harness.cleanup();
    }
  });

  it("processes dispute review jobs and attaches provider response status", async () => {
    const harness = await createHarness("modeltruth-worker-dispute-review-");
    const disputes = await createProviderDisputeRepository();
    let disputeId = "";
    try {
      const dispute = await disputes.create({
        providerSlug: "openrouter",
        runId: "run_warning",
        contactEmail: "provider@example.com",
        statement: "Please review this technical audit result and attach our response."
      });
      disputeId = dispute.id;
    } finally {
      await disputes.close();
    }

    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "disputeReview",
        maxAttempts: 1,
        payload: {
          source: "dispute-policy",
          disputeId,
          providerSlug: "openrouter",
          runId: "run_warning",
          reviewDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        }
      });
    } finally {
      await jobs.close();
    }

    await runWorkerTick();

    const refreshedDisputes = await createProviderDisputeRepository();
    const refreshedJobs = await createJobRepository();
    try {
      const dispute = (await refreshedDisputes.listByProvider("openrouter")).find((item) => item.id === disputeId);
      const remainingJob = await refreshedJobs.claimNext({ workerId: "test", types: ["disputeReview"] });
      expect(dispute?.status).toBe("provider_response_attached");
      expect(remainingJob).toBeUndefined();
    } finally {
      await refreshedJobs.close();
      await refreshedDisputes.close();
      harness.cleanup();
    }
  });

  it("stores full private responses only when the workspace opts in", async () => {
    const harness = await createHarness("modeltruth-worker-full-response-");
    const workspaceId = await createWorkspace({ saveFullResponses: true });
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          workspaceId,
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-worker-test",
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
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "private full response body allowed by workspace setting" } }],
            usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    await runWorkerTick();

    const runs = await listAuditRuns({ workspaceId });
    const evidence = await getEvidencePackage(runs[0].runId);
    harness.cleanup();

    expect(evidence?.evidenceSummary).toMatchObject({
      responseBodyStored: true,
      fullResponse: "private full response body allowed by workspace setting",
      fullResponseStored: true,
      fullResponsePolicy: "workspace_opt_in"
    });
  });

  it("does not store full private responses by default", async () => {
    const harness = await createHarness("modeltruth-worker-full-response-default-off-");
    const workspaceId = await createWorkspace({ saveFullResponses: false });
    const jobs = await createJobRepository();
    try {
      await jobs.enqueue({
        type: "deepAudit",
        payload: {
          workspaceId,
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-worker-test",
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
        new Response(JSON.stringify({ choices: [{ message: { content: "private response should not persist" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );

    await runWorkerTick();

    const runs = await listAuditRuns({ workspaceId });
    const evidence = await getEvidencePackage(runs[0].runId);
    harness.cleanup();

    expect(JSON.stringify(evidence)).not.toContain("private response should not persist");
    expect(evidence?.evidenceSummary).toMatchObject({
      responseBodyStored: false,
      fullResponseStored: false,
      fullResponsePolicy: "not_stored"
    });
  });
});

async function createHarness(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
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

async function seedPreviousDeepAuditFail(id: string) {
  await saveAuditRun({
    id,
    workspaceId: "ws_alert",
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType: "deepAudit",
    targetModelId: "gpt-5.1",
    status: "fail",
    confidence: 0.9,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    metrics: { statusCode: 500 },
    assertions: [{ id: "HTTP_STATUS_OK", status: "fail", confidence: 1, message: "Endpoint returned HTTP 500" }],
    evidenceSummary: { requestBodyStored: false }
  });
}

async function enqueueFailingDeepAudit(jobs: Awaited<ReturnType<typeof createJobRepository>>) {
  await jobs.enqueue({
    type: "deepAudit",
    payload: {
      workspaceId: "ws_alert",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-worker-test",
      model: "gpt-5.1",
      suiteId: "smoke@1.0.0"
    }
  });
}

async function createWorkspace(input: { saveFullResponses: boolean }) {
  const auth = await createAuthRepository();
  try {
    const link = await auth.createMagicLink(`worker-${crypto.randomUUID()}@example.com`);
    const login = await auth.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create workspace");
    const privacy = await createWorkspacePrivacyRepository();
    try {
      await privacy.update(login.session.workspace.id, { saveFullResponses: input.saveFullResponses });
    } finally {
      await privacy.close();
    }
    return login.session.workspace.id;
  } finally {
    await auth.close();
  }
}
