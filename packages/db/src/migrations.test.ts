import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady, parsePostgresUrl } from "./index";

describe("ensureSqliteReady", () => {
  it("creates a SQLite database and records migrations with file hash", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "modeltruth-db-"));
    const migrationsDir = path.join(cwd, "migrations");
    mkdirSync(migrationsDir);
    writeFileSync(
      path.join(migrationsDir, "000_init_schema_consolidated.sql"),
      "create table users (id text primary key, email text not null unique);"
    );

    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    const firstRun = await ensureSqliteReady({ cwd, databasePath });
    const secondRun = await ensureSqliteReady({ cwd, databasePath });

    const db = new DatabaseSync(databasePath);
    const migration = db.prepare("select migration_name, file_hash from migration_history").get() as {
      migration_name: string;
      file_hash: string;
    };
    const userTable = db.prepare("select name from sqlite_master where type = 'table' and name = 'users'").get();
    db.close();
    rmSync(cwd, { recursive: true, force: true });

    expect(firstRun).toEqual({ type: "sqlite", scanned: 1, executed: 1 });
    expect(secondRun).toEqual({ type: "sqlite", scanned: 1, executed: 0 });
    expect(migration.migration_name).toBe("000_init_schema_consolidated.sql");
    expect(migration.file_hash.length).toBe(64);
    expect(userTable).toBeTruthy();
  });
});

describe("parsePostgresUrl", () => {
  it("derives target and server URLs from DATABASE_URL", () => {
    const parsed = parsePostgresUrl("postgresql://user:pass@localhost:5432/modeltruth?sslmode=require");

    expect(parsed.dbName).toBe("modeltruth");
    expect(parsed.databaseUrl).toBe("postgresql://user:pass@localhost:5432/modeltruth?sslmode=require");
    expect(parsed.serverUrl).toBe("postgresql://user:pass@localhost:5432/postgres?sslmode=require");
  });

  it("accepts URLs without protocol for deployment templates", () => {
    const parsed = parsePostgresUrl("user:pass@db.internal:5432/modeltruth");

    expect(parsed.dbName).toBe("modeltruth");
    expect(parsed.databaseUrl).toBe("postgresql://user:pass@db.internal:5432/modeltruth");
  });
});
