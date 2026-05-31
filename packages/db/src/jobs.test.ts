import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureSqliteReady } from "./index";
import { createJobRepository, resolveRetryDelayMs } from "./jobs";

describe("JobRepository", () => {
  it("enqueues, claims, completes and retries SQLite jobs", async () => {
    const harness = await createHarness();
    const repo = await createJobRepository();
    try {
      const queued = await repo.enqueue({ type: "heartbeat", payload: { nodeId: "node_1" } });
      const claimed = await repo.claimNext({ workerId: "worker_1", types: ["heartbeat"] });
      await repo.complete(queued.id);

      expect(claimed?.id).toBe(queued.id);
      expect(claimed?.status).toBe("running");
      expect(claimed?.attempts).toBe(1);
    } finally {
      await repo.close();
      harness.cleanup();
    }
  });

  it("heartbeats running jobs and reclaims stale leases", async () => {
    const harness = await createHarness();
    const repo = await createJobRepository();
    try {
      const startedAt = new Date("2026-05-31T00:00:00.000Z");
      const queued = await repo.enqueue({ type: "heartbeat", payload: { nodeId: "node_1" }, runAfter: startedAt });
      const firstClaim = await repo.claimNext({
        workerId: "worker_1",
        types: ["heartbeat"],
        now: startedAt,
        leaseTimeoutMs: 1000
      });

      const freshReclaim = await repo.claimNext({
        workerId: "worker_2",
        types: ["heartbeat"],
        now: new Date("2026-05-31T00:00:00.500Z"),
        leaseTimeoutMs: 1000
      });
      await repo.heartbeat(queued.id, "worker_1", new Date("2026-05-31T00:00:01.500Z"));
      const afterHeartbeat = await repo.claimNext({
        workerId: "worker_2",
        types: ["heartbeat"],
        now: new Date("2026-05-31T00:00:02.000Z"),
        leaseTimeoutMs: 1000
      });
      const staleReclaim = await repo.claimNext({
        workerId: "worker_2",
        types: ["heartbeat"],
        now: new Date("2026-05-31T00:00:03.000Z"),
        leaseTimeoutMs: 1000
      });

      expect(firstClaim?.id).toBe(queued.id);
      expect(freshReclaim).toBeUndefined();
      expect(afterHeartbeat).toBeUndefined();
      expect(staleReclaim?.id).toBe(queued.id);
      expect(staleReclaim?.lockedBy).toBe("worker_2");
      expect(staleReclaim?.attempts).toBe(2);
    } finally {
      await repo.close();
      harness.cleanup();
    }
  });

  it("detects active and recent fingerprints for idempotency and alert dedupe", async () => {
    const harness = await createHarness();
    const repo = await createJobRepository();
    try {
      const queued = await repo.enqueue({
        type: "alert",
        payload: { fingerprint: "alert:ws_1:node_1:p95_ttft:warning" },
        runAfter: new Date("2026-05-31T00:00:00.000Z")
      });
      const active = await repo.hasActiveFingerprint("alert", "alert:ws_1:node_1:p95_ttft:warning");
      await repo.complete(queued.id);
      const recent = await repo.hasRecentFingerprint(
        "alert",
        "alert:ws_1:node_1:p95_ttft:warning",
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      );
      const unrelated = await repo.hasRecentFingerprint(
        "alert",
        "alert:ws_1:node_1:uptime_5m:warning",
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      );

      expect(active).toBe(true);
      expect(recent).toBe(true);
      expect(unrelated).toBe(false);
    } finally {
      await repo.close();
      harness.cleanup();
    }
  });

  it("uses the documented 10s, 60s and 300s retry backoff schedule", async () => {
    const harness = await createHarness();
    const repo = await createJobRepository();
    const now = new Date("2026-05-31T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const queued = await repo.enqueue({ type: "heartbeat", payload: { nodeId: "node_1" }, runAfter: now });
      const first = await repo.claimNext({ workerId: "worker_1", types: ["heartbeat"], now });
      await repo.fail(first!.id, "first failure");
      const retryAt10s = await repo.claimNext({
        workerId: "worker_1",
        types: ["heartbeat"],
        now: new Date(now.getTime() + 10_000)
      });
      await repo.fail(retryAt10s!.id, "second failure");
      const retryAt60s = await repo.claimNext({
        workerId: "worker_1",
        types: ["heartbeat"],
        now: new Date(now.getTime() + 70_000)
      });
      await repo.fail(retryAt60s!.id, "third failure");
      const exhausted = await repo.claimNext({
        workerId: "worker_1",
        types: ["heartbeat"],
        now: new Date(now.getTime() + 370_000)
      });

      expect(queued.maxAttempts).toBe(3);
      expect(retryAt10s?.attempts).toBe(2);
      expect(retryAt60s?.attempts).toBe(3);
      expect(exhausted).toBeUndefined();
      expect(resolveRetryDelayMs(1)).toBe(10_000);
      expect(resolveRetryDelayMs(2)).toBe(60_000);
      expect(resolveRetryDelayMs(3)).toBe(300_000);
    } finally {
      vi.useRealTimers();
      await repo.close();
      harness.cleanup();
    }
  });
});

async function createHarness() {
  const cwd = mkdtempSync(path.join(tmpdir(), "modeltruth-jobs-"));
  mkdirSync(path.join(cwd, "migrations"));
  writeFileSync(
    path.join(cwd, "migrations", "000_init_schema_consolidated.sql"),
    `create table jobs (
      id text primary key,
      type text not null,
      status text not null default 'queued',
      payload_json text not null,
      attempts integer not null default 0,
      max_attempts integer not null default 3,
      run_after text not null,
      locked_at text,
      locked_by text,
      last_error text,
      created_at text not null,
      updated_at text not null
    );`
  );

  const previousPath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(cwd, "data", "modeltruth.sqlite");
  await ensureSqliteReady({ cwd, databasePath: process.env.DATABASE_PATH });
  return {
    cleanup() {
      process.env.DATABASE_PATH = previousPath;
      rmSync(cwd, { recursive: true, force: true });
    }
  };
}
