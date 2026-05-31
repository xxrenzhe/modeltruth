import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, ensureSqliteReady, saveAuditRun } from "@modeltruth/db";
import { GET } from "./app/api/reports/monthly/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("monthly report API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication and blocks Free workspaces", async () => {
    const unauthenticated = await GET(new Request("http://localhost/api/reports/monthly?month=2026-05"));
    await createSession("free");
    const freeResponse = await GET(new Request("http://localhost/api/reports/monthly?month=2026-05"));

    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ error: "authentication required" });
    expect(freeResponse.status).toBe(403);
    expect(await freeResponse.json()).toEqual({ error: "monthly audit report export requires Pro or Team" });
  });

  it("exports only the current workspace month for Pro and Team users", async () => {
    const session = await createSession("pro", "monthly-pro@example.com");
    await seedRun("run_visible", session.workspace.id, "2026-05-10T10:00:00.000Z", "pass", 120);
    await seedRun("run_other_month", session.workspace.id, "2026-04-30T10:00:00.000Z", "fail", 900);
    await seedRun("run_other_workspace", "workspace_other", "2026-05-15T10:00:00.000Z", "warning", 800);

    const response = await GET(new Request("http://localhost/api/reports/monthly?month=2026-05"));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="modeltruth-${session.workspace.id}-2026-05.json"`);
    expect(body.report).toMatchObject({
      schemaVersion: "modeltruth.monthly-audit-report.v1",
      workspaceId: session.workspace.id,
      month: "2026-05",
      totals: { totalRuns: 1, passRate: 1 }
    });
    expect(body.report.runs.map((run: { runId: string }) => run.runId)).toEqual(["run_visible"]);
    expect(serialized).not.toContain("run_other_month");
    expect(serialized).not.toContain("run_other_workspace");
  });

  it("rejects malformed month parameters before exporting", async () => {
    await createSession("team", "monthly-team@example.com");

    const response = await GET(new Request("http://localhost/api/reports/monthly?month=2026-13"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("month must use YYYY-MM format");
  });
});

async function createSession(tier: "free" | "pro" | "team", email = `monthly-${tier}@example.com`) {
  if (!tempDir) {
    tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-monthly-report-api-"));
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  }
  const auth = await createAuthRepository();
  try {
    const login = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!login) throw new Error("failed to create monthly report session");
    if (tier !== "free") {
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
      const refreshed = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
      if (!refreshed) throw new Error("failed to refresh monthly report session");
      cookieState.sessionToken = refreshed.sessionToken;
      return refreshed.session;
    }
    cookieState.sessionToken = login.sessionToken;
    return login.session;
  } finally {
    await auth.close();
  }
}

async function seedRun(id: string, workspaceId: string, createdAt: string, status: "pass" | "warning" | "fail", ttftMs: number) {
  await saveAuditRun({
    id,
    workspaceId,
    providerSlug: "openai",
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType: "heartbeat",
    targetModelId: "gpt-5.1",
    status,
    confidence: 0.9,
    createdAt,
    metrics: { ttftMs, statusCode: status === "fail" ? 500 : 200 },
    assertions: [{ id: "HTTP_STATUS_OK", status }],
    evidenceSummary: { requestBodyStored: false }
  });
}
