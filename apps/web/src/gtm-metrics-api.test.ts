import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthRepository, createBillingRepository, ensureSqliteReady, saveAuditRun } from "@modeltruth/db";
import { GET } from "./app/api/gtm/metrics/route";

let previousDatabasePath: string | undefined;
let previousToken: string | undefined;
let tempDir: string | undefined;

describe("GTM metrics API", () => {
  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousToken === undefined) delete process.env.MODELTRUTH_GTM_METRICS_TOKEN;
    else process.env.MODELTRUTH_GTM_METRICS_TOKEN = previousToken;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("hides the endpoint unless an internal metrics token is configured", async () => {
    await setupDatabase();
    delete process.env.MODELTRUTH_GTM_METRICS_TOKEN;

    const response = await GET(new Request("http://localhost/api/gtm/metrics"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  it("requires a bearer token and returns only aggregate KPI data", async () => {
    await setupDatabase();
    process.env.MODELTRUTH_GTM_METRICS_TOKEN = "gtm_secret";
    await createPaidWorkspace("gtm-api@example.com");
    await saveAuditRun({
      id: "run_gtm_api",
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "playground",
      targetModelId: "gpt-5.1",
      status: "warning",
      confidence: 0.9,
      metrics: { statusCode: 200 },
      assertions: [{ id: "HTTP_STATUS_OK", status: "warning" }],
      evidenceSummary: { requestBodyStored: false }
    });

    const denied = await GET(new Request("http://localhost/api/gtm/metrics", { headers: { authorization: "Bearer wrong" } }));
    const allowed = await GET(new Request("http://localhost/api/gtm/metrics", { headers: { authorization: "Bearer gtm_secret" } }));
    const body = await allowed.json();
    const serialized = JSON.stringify(body);

    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthorized" });
    expect(allowed.status).toBe(200);
    expect(body.snapshot).toMatchObject({
      schemaVersion: "modeltruth.gtm-metrics.v1",
      activation: { auditRuns: 1, playgroundAuditRuns: 1, playgroundWarningOrFailRuns: 1 },
      revenue: { proSubscriptions: 1, paidSubscriptions: 1, mrrUsd: 19 }
    });
    expect(serialized).not.toContain("gtm-api@example.com");
    expect(serialized).not.toContain("api.example.com");
  });
});

async function setupDatabase() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-gtm-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  previousToken = process.env.MODELTRUTH_GTM_METRICS_TOKEN;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
}

async function createPaidWorkspace(email: string) {
  const auth = await createAuthRepository();
  try {
    const login = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!login) throw new Error("failed to create workspace");
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({
        workspaceId: login.session.workspace.id,
        stripeCustomerId: "cus_gtm",
        stripeSubscriptionId: "sub_gtm",
        subscriptionStatus: "active",
        tier: "pro"
      });
    } finally {
      await billing.close();
    }
  } finally {
    await auth.close();
  }
}
