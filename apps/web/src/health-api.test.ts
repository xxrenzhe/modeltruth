import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "@modeltruth/db";
import { GET } from "./app/api/health/route";

describe("Health API", () => {
  it("returns ready status with database type after startup migrations have run", async () => {
    const harness = await createHarness("modeltruth-health-ready-");
    const response = await GET();
    const body = await response.json();
    harness.cleanup();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "modeltruth-web",
      database: { ok: true, type: "sqlite" }
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it("fails closed when the SQLite database has not been initialized", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-health-missing-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "missing.sqlite");
    const response = await GET();
    const body = await response.json();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      service: "modeltruth-web",
      database: { ok: false, type: "sqlite", reason: "missing_sqlite_db" }
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
