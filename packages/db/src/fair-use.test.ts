import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuthRepository } from "./auth";
import { createBillingRepository } from "./billing";
import { getWorkspaceFairUseStatus } from "./fair-use";
import { ensureSqliteReady } from "./index";
import { saveAuditRun } from "./audit-runs";

describe("getWorkspaceFairUseStatus", () => {
  it("downshifts paid workspaces after audit cost exceeds 40 percent of plan revenue", async () => {
    const harness = await createHarness("modeltruth-fair-use-pro-");
    const workspaceId = await createWorkspace("fair-use-pro@example.com");
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({ workspaceId, subscriptionStatus: "active", tier: "pro" });
    } finally {
      await billing.close();
    }
    await saveCostedRun(workspaceId, 8);

    const status = await getWorkspaceFairUseStatus(workspaceId, new Date());
    harness.cleanup();

    expect(status).toMatchObject({
      tier: "pro",
      monthlyRevenueUsd: 19,
      budgetUsd: 7.6,
      currentMonthCostUsd: 8,
      action: "downshift",
      reason: "monthly_audit_cost_exceeded_40_percent_of_plan_revenue"
    });
    expect(status.recommendedDeepAuditDelayMs).toBe(24 * 60 * 60 * 1000);
  });

  it("prompts free workspaces to upgrade when stored audit cost exists", async () => {
    const harness = await createHarness("modeltruth-fair-use-free-");
    const workspaceId = await createWorkspace("fair-use-free@example.com");
    await saveCostedRun(workspaceId, 0.1);

    const status = await getWorkspaceFairUseStatus(workspaceId, new Date());
    harness.cleanup();

    expect(status).toMatchObject({
      tier: "free",
      monthlyRevenueUsd: 0,
      budgetUsd: 0,
      currentMonthCostUsd: 0.1,
      action: "upgrade_prompt"
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

async function createWorkspace(email: string) {
  const auth = await createAuthRepository();
  try {
    const link = await auth.createMagicLink(email);
    const login = await auth.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create fair-use workspace");
    return login.session.workspace.id;
  } finally {
    await auth.close();
  }
}

async function saveCostedRun(workspaceId: string, totalCostUsd: number) {
  await saveAuditRun({
    id: crypto.randomUUID(),
    workspaceId,
    suiteId: "reasoning-lite",
    suiteVersion: "1.0.0",
    runType: "deepAudit",
    targetModelId: "gpt-5.1",
    status: "pass",
    confidence: 0.9,
    metrics: { costEstimate: { totalCostUsd, currency: "USD" } },
    assertions: [{ id: "COST_TRACKED", status: "pass" }],
    evidenceSummary: { requestBodyStored: false }
  });
}
