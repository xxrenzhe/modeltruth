import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuthRepository } from "./auth";
import { createBillingRepository } from "./billing";
import { buildGtmMetricsSnapshot } from "./gtm-metrics";
import { ensureSqliteReady } from "./index";
import { createProviderNodeRepository } from "./provider-nodes";
import { createProviderSubscriptionRepository } from "./provider-subscriptions";
import { saveAuditRun } from "./audit-runs";
import { createGtmAnalyticsRepository } from "./gtm-analytics";
import { createWaitlistRepository } from "./waitlist";

describe("buildGtmMetricsSnapshot", () => {
  it("aggregates Beta KPI progress from business tables without exposing emails or raw endpoints", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-gtm-metrics-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
    const now = new Date("2026-06-01T00:00:00.000Z");
    const proWorkspaceId = await createWorkspace("gtm-pro@example.com", "pro");
    await createWorkspace("gtm-team@example.com", "team");
    await createPaidNode(proWorkspaceId);
    await createProviderSubscription();
    await createWaitlistSignup();
    await recordLaunchMetrics();
    await seedRun("run_playground_pass", "playground", "pass", "2026-05-20T00:00:00.000Z");
    await seedRun("run_playground_warning", "playground", "warning", "2026-05-21T00:00:00.000Z");
    await seedRun("run_cli", "cli", "pass", "2026-05-22T00:00:00.000Z");
    await seedRun("run_old", "playground", "pass", "2026-04-01T00:00:00.000Z");

    const snapshot = await buildGtmMetricsSnapshot({ now, windowDays: 30 });
    const serialized = JSON.stringify(snapshot);
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(snapshot.activation).toMatchObject({
      auditRuns: 3,
      playgroundAuditRuns: 2,
      cliAuditRuns: 1,
      playgroundWarningOrFailRuns: 1,
      firstPaidNodeActivations: 1,
      providerSubscriptions: 1,
      waitlistSignups: 1
    });
    expect(snapshot.revenue).toEqual({ proSubscriptions: 1, teamSubscriptions: 1, paidSubscriptions: 2, mrrUsd: 98 });
    expect(snapshot.beta30Targets).toMatchObject({ auditRunsTarget: 1000, proSubscriptionsTarget: 20, mrrUsdTarget: 380 });
    expect(snapshot.launch).toEqual({
      monthlyVisits: 3,
      dashboardWeeklyActiveVisitors: 2,
      githubStars: 333,
      packageDownloads: 444,
      cliInstalls: 222
    });
    expect(snapshot.beta30Targets).toMatchObject({ cliInstallsTarget: 500, cliInstallsProgress: 222 / 500 });
    expect(snapshot.launch90Targets).toMatchObject({
      monthlyVisitsTarget: 10000,
      paidSubscriptionsTarget: 100,
      mrrUsdTarget: 2500,
      cliStarsOrDownloadsTarget: 1000,
      dashboardWeeklyActiveVisitorsTarget: 2000
    });
    expect(snapshot.privacy).toEqual({
      storesRawEndpointPath: false,
      storesHeaders: false,
      storesRequestBody: false,
      storesEmailInResponse: false
    });
    expect(serialized).not.toContain("gtm-pro@example.com");
    expect(serialized).not.toContain("https://api.example.com/v1");
    expect(serialized).not.toContain("visitor-one");
  });
});

async function createWorkspace(email: string, tier: "pro" | "team") {
  const auth = await createAuthRepository();
  try {
    const login = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!login) throw new Error("failed to create workspace");
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({
        workspaceId: login.session.workspace.id,
        stripeCustomerId: `cus_${tier}`,
        stripeSubscriptionId: `sub_${tier}`,
        subscriptionStatus: "active",
        tier
      });
    } finally {
      await billing.close();
    }
    return login.session.workspace.id;
  } finally {
    await auth.close();
  }
}

async function createPaidNode(workspaceId: string) {
  const repo = await createProviderNodeRepository();
  try {
    await repo.create({
      workspaceId,
      name: "Production gateway",
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "host_hash",
      modelId: "gpt-5.1",
      encryptedApiKey: "encrypted",
      apiKeySuffix: "test"
    });
  } finally {
    await repo.close();
  }
}

async function createProviderSubscription() {
  const repo = await createProviderSubscriptionRepository();
  try {
    await repo.create({ providerSlug: "openrouter", email: "risk@example.com", notificationType: "risk_trend" });
  } finally {
    await repo.close();
  }
}

async function createWaitlistSignup() {
  const repo = await createWaitlistRepository();
  try {
    await repo.create({ email: "waitlist@example.com", source: "homepage" });
  } finally {
    await repo.close();
  }
}

async function recordLaunchMetrics() {
  const repo = await createGtmAnalyticsRepository();
  try {
    await repo.recordVisit({
      surface: "public_dashboard",
      visitorSeed: "visitor-one",
      occurredAt: new Date("2026-05-30T00:00:00.000Z")
    });
    await repo.recordVisit({
      surface: "public_dashboard",
      visitorSeed: "visitor-one",
      occurredAt: new Date("2026-05-30T01:00:00.000Z")
    });
    await repo.recordVisit({
      surface: "provider_board",
      visitorSeed: "visitor-two",
      occurredAt: new Date("2026-05-31T00:00:00.000Z")
    });
    await repo.upsertExternalMetric({ source: "github_stars", metricValue: 333 });
    await repo.upsertExternalMetric({ source: "package_downloads", metricValue: 444 });
    await repo.upsertExternalMetric({ source: "cli_installs", metricValue: 222 });
  } finally {
    await repo.close();
  }
}

async function seedRun(id: string, runType: "playground" | "cli", status: "pass" | "warning", createdAt: string) {
  await saveAuditRun({
    id,
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType,
    targetModelId: "gpt-5.1",
    status,
    confidence: 0.9,
    createdAt,
    metrics: { statusCode: 200, ttftMs: 100 },
    assertions: [{ id: "HTTP_STATUS_OK", status }],
    evidenceSummary: { requestBodyStored: false }
  });
}
