import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createJobRepository } from "./jobs";

describe("JobRepository", () => {
  it("enqueues, claims, completes and retries SQLite jobs", async () => {
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
    const repo = await createJobRepository();
    const queued = await repo.enqueue({ type: "heartbeat", payload: { nodeId: "node_1" } });
    const claimed = await repo.claimNext({ workerId: "worker_1", types: ["heartbeat"] });
    await repo.complete(queued.id);
    await repo.close();
    process.env.DATABASE_PATH = previousPath;
    rmSync(cwd, { recursive: true, force: true });

    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });
});
