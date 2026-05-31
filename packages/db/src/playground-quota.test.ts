import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createPlaygroundQuotaRepository } from "./playground-quota";

describe("PlaygroundQuotaRepository", () => {
  it("limits a quota key to three audit attempts per window", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-quota-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createPlaygroundQuotaRepository();
    const first = await repo.consume("quota_hash");
    const second = await repo.consume("quota_hash");
    const third = await repo.consume("quota_hash");
    const fourth = await repo.consume("quota_hash");
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(first.allowed).toBe(true);
    expect(second.remaining).toBe(1);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });
});
