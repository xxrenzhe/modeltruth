import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJobRepository, createProviderDisputeRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST as submitDispute } from "./app/api/disputes/route";

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("dispute review flow", () => {
  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("persists provider dispute submissions and enqueues review jobs", async () => {
    await setupDatabase();

    const response = await submitDispute(
      jsonRequest({
        providerSlug: "OpenRouter",
        requestType: "takedown",
        runId: "run_warning",
        contactEmail: "provider@example.com",
        statement: "Please review this technical audit result and attach our correction.",
        evidenceUrl: "https://provider.example.com/review"
      })
    );
    const body = await response.json();
    const disputes = await listProviderDisputes("openrouter");
    const jobs = await createJobRepository();
    const job = await jobs.claimNext({ workerId: "test-dispute", types: ["disputeReview"] });
    await jobs.close();

    expect(response.status).toBe(201);
    expect(body.dispute).toMatchObject({ providerSlug: "openrouter", requestType: "takedown", runId: "run_warning" });
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ contactEmail: "provider@example.com", status: "under_review" });
    expect(job?.type).toBe("disputeReview");
    expect(JSON.parse(job!.payloadJson)).toMatchObject({
      source: "dispute-policy",
      disputeId: body.dispute.id,
      providerSlug: "openrouter",
      requestType: "takedown",
      runId: "run_warning"
    });
  });

  it("rejects non-HTTPS dispute evidence URLs", async () => {
    await setupDatabase();

    const response = await submitDispute(
      jsonRequest({
        providerSlug: "openrouter",
        contactEmail: "provider@example.com",
        statement: "Please review this technical audit result and correction.",
        evidenceUrl: "http://provider.example.com/review"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("evidenceUrl must use HTTPS");
  });

  it("starts a review job when a provider dispute is submitted", () => {
    const source = readFileSync("apps/web/src/app/api/disputes/route.ts", "utf8");

    expect(source).toContain('type: "disputeReview"');
    expect(source).toContain("requestType");
    expect(source).toContain("reviewStartedAt");
    expect(source).toContain("reviewDueAt");
    expect(source).toContain("dispute-policy");
  });

  it("renders database-backed provider review status on public provider boards", () => {
    const source = readFileSync("apps/web/src/app/[locale]/providers/[providerSlug]/page.tsx", "utf8");

    expect(source).toContain("createProviderDisputeRepository");
    expect(source).toContain("listProviderDisputes");
    expect(source).toContain("provider_response_attached");
    expect(source).toContain("Updated after review");
    expect(source).toContain("Resolved");
    expect(source).toContain("Under review");
    expect(source).toContain("disputeStatusLabel");
    expect(source).toContain("reviewStatusClass");
    expect(source).toContain("requestTypeLabel");
    expect(source).toContain("takedown");
    expect(source).toContain("POST /api/disputes");
  });

  it("renders Provider Truth/Risk subscription intake on public provider boards", () => {
    const source = readFileSync("apps/web/src/app/[locale]/providers/[providerSlug]/page.tsx", "utf8");

    expect(source).toContain("/api/providers/subscribe");
    expect(source).toContain("risk_trend");
    expect(source).toContain("weekly_digest");
    expect(source).toContain("Truth/Risk changes");
  });

  it("documents correction, provider response and takedown intake on the dispute page", () => {
    const source = readFileSync("apps/web/src/app/[locale]/dispute/page.tsx", "utf8");

    expect(source).toContain("requestType");
    expect(source).toContain("correction");
    expect(source).toContain("provider_response");
    expect(source).toContain("takedown");
  });
});

async function setupDatabase() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-dispute-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
}

async function listProviderDisputes(providerSlug: string) {
  const repo = await createProviderDisputeRepository();
  try {
    return await repo.listByProvider(providerSlug);
  } finally {
    await repo.close();
  }
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/disputes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
