import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";

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
    await ensureSqliteReady({ cwd, databasePath });

    const db = new DatabaseSync(databasePath);
    const migration = db.prepare("select migration_name, file_hash from migration_history").get() as {
      migration_name: string;
      file_hash: string;
    };
    const userTable = db.prepare("select name from sqlite_master where type = 'table' and name = 'users'").get();
    db.close();
    rmSync(cwd, { recursive: true, force: true });

    expect(migration.migration_name).toBe("000_init_schema_consolidated.sql");
    expect(migration.file_hash.length).toBe(64);
    expect(userTable).toBeTruthy();
  });
});
