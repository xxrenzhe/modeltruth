import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createJobRepository, createProviderDisputeRepository, ensureSqliteReady } from "@modeltruth/db";
import { runWorkerTick } from "./index";

describe("runWorkerTick dispute review jobs", () => {
  it("starts correction review without attaching provider response status", async () => {
    const harness = await createHarness("modeltruth-worker-dispute-correction-");
    try {
      const disputeId = await createDispute("correction");
      await enqueueReview(disputeId, "correction");

      await runWorkerTick();

      const dispute = await findDispute(disputeId);
      const remainingJob = await claimRemainingReviewJob();

      expect(dispute?.status).toBe("under_review");
      expect(remainingJob).toBeUndefined();
    } finally {
      harness.cleanup();
    }
  });

  it("attaches provider response status only for provider response reviews", async () => {
    const harness = await createHarness("modeltruth-worker-dispute-response-");
    try {
      const disputeId = await createDispute("provider_response");
      await enqueueReview(disputeId, "provider_response");

      await runWorkerTick();

      const dispute = await findDispute(disputeId);
      const remainingJob = await claimRemainingReviewJob();

      expect(dispute?.status).toBe("provider_response_attached");
      expect(remainingJob).toBeUndefined();
    } finally {
      harness.cleanup();
    }
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

async function createDispute(requestType: "correction" | "provider_response") {
  const disputes = await createProviderDisputeRepository();
  try {
    const dispute = await disputes.create({
      providerSlug: "openrouter",
      requestType,
      runId: "run_warning",
      contactEmail: "provider@example.com",
      statement: "Please review this technical audit result and attach our response."
    });
    return dispute.id;
  } finally {
    await disputes.close();
  }
}

async function enqueueReview(disputeId: string, requestType: "correction" | "provider_response") {
  const jobs = await createJobRepository();
  try {
    await jobs.enqueue({
      type: "disputeReview",
      maxAttempts: 1,
      payload: {
        source: "dispute-policy",
        disputeId,
        providerSlug: "openrouter",
        requestType,
        runId: "run_warning",
        reviewDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      }
    });
  } finally {
    await jobs.close();
  }
}

async function findDispute(disputeId: string) {
  const disputes = await createProviderDisputeRepository();
  try {
    return (await disputes.listByProvider("openrouter")).find((item) => item.id === disputeId);
  } finally {
    await disputes.close();
  }
}

async function claimRemainingReviewJob() {
  const jobs = await createJobRepository();
  try {
    return await jobs.claimNext({ workerId: "test", types: ["disputeReview"] });
  } finally {
    await jobs.close();
  }
}
