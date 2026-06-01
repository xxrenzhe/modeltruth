import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createProviderDisputeRepository } from "./disputes";

describe("ProviderDisputeRepository", () => {
  it("records provider dispute submissions with neutral review status", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-disputes-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createProviderDisputeRepository();
    const dispute = await repo.create({
      providerSlug: "openrouter",
      runId: "run_warning",
      requestType: "takedown",
      contactEmail: "provider@example.com",
      statement: "Please review this technical audit result.",
      evidenceUrl: "https://provider.example.com/response"
    });
    const disputes = await repo.listByProvider("openrouter");
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(dispute.status).toBe("under_review");
    expect(dispute.reviewStartedAt).toBeTruthy();
    expect(dispute.reviewDueAt).toBeTruthy();
    expect(new Date(dispute.reviewDueAt!).getTime() - new Date(dispute.reviewStartedAt!).getTime()).toBe(48 * 60 * 60 * 1000);
    expect(disputes[0].runId).toBe("run_warning");
    expect(disputes[0].requestType).toBe("takedown");
    expect(disputes[0].contactEmail).toBe("provider@example.com");
    expect(disputes[0].reviewStartedAt).toBe(dispute.reviewStartedAt);
  });

  it("marks a dispute as provider response attached after review intake", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-dispute-review-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createProviderDisputeRepository();
    const dispute = await repo.create({
      providerSlug: "openrouter",
      contactEmail: "provider-review@example.com",
      statement: "Please attach this provider response to the reviewed audit."
    });
    const updated = await repo.markProviderResponseAttached(dispute.id);
    const disputes = await repo.listByProvider("openrouter");
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(updated?.status).toBe("provider_response_attached");
    expect(disputes[0].status).toBe("provider_response_attached");
  });

  it("keeps correction and takedown reviews under review until resolved", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-dispute-review-started-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createProviderDisputeRepository();
    const dispute = await repo.create({
      providerSlug: "openrouter",
      requestType: "takedown",
      contactEmail: "provider-review@example.com",
      statement: "Please review this public technical audit result."
    });
    const updated = await repo.markReviewStarted(dispute.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(updated?.status).toBe("under_review");
  });

  it("marks reviewed disputes as resolved for public status display", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-dispute-resolved-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createProviderDisputeRepository();
    const dispute = await repo.create({
      providerSlug: "openrouter",
      contactEmail: "provider-resolved@example.com",
      statement: "Please review and resolve this public technical audit result."
    });
    const updated = await repo.markResolved(dispute.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(updated?.status).toBe("resolved");
  });
});
