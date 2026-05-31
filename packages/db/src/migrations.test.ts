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

  it("records failed SQLite migrations with file hash and error context", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "modeltruth-db-failure-"));
    const migrationsDir = path.join(cwd, "migrations");
    mkdirSync(migrationsDir);
    writeFileSync(path.join(migrationsDir, "000_init_schema_consolidated.sql"), "create table users (id text primary key);");
    writeFileSync(path.join(migrationsDir, "001_broken.sql"), "create table broken (id text primary key");

    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    await expect(ensureSqliteReady({ cwd, databasePath })).rejects.toThrow();

    const db = new DatabaseSync(databasePath);
    const failed = db.prepare("select migration_name, file_hash, status, failed_at, last_error from migration_history where migration_name = ?").get("001_broken.sql") as {
      migration_name: string;
      file_hash: string;
      status: string;
      failed_at: string;
      last_error: string;
    };
    db.close();
    rmSync(cwd, { recursive: true, force: true });

    expect(failed.migration_name).toBe("001_broken.sql");
    expect(failed.file_hash.length).toBe(64);
    expect(failed.status).toBe("failed");
    expect(failed.failed_at).toBeTruthy();
    expect(failed.last_error.length).toBeGreaterThan(0);
  });

  it("retries a fixed failed SQLite migration and marks it applied", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "modeltruth-db-retry-failure-"));
    const migrationsDir = path.join(cwd, "migrations");
    mkdirSync(migrationsDir);
    writeFileSync(path.join(migrationsDir, "000_init_schema_consolidated.sql"), "create table users (id text primary key);");
    const migrationPath = path.join(migrationsDir, "001_retryable.sql");
    writeFileSync(migrationPath, "create table retryable (id text primary key");

    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    await expect(ensureSqliteReady({ cwd, databasePath })).rejects.toThrow();
    writeFileSync(migrationPath, "create table retryable (id text primary key);");
    const result = await ensureSqliteReady({ cwd, databasePath });

    const db = new DatabaseSync(databasePath);
    const retried = db.prepare("select status, failed_at, last_error from migration_history where migration_name = ?").get("001_retryable.sql") as {
      status: string;
      failed_at: string | null;
      last_error: string | null;
    };
    const table = db.prepare("select name from sqlite_master where type = 'table' and name = 'retryable'").get();
    db.close();
    rmSync(cwd, { recursive: true, force: true });

    expect(result).toEqual({ type: "sqlite", scanned: 2, executed: 1 });
    expect(retried).toEqual({ status: "applied", failed_at: null, last_error: null });
    expect(table).toBeTruthy();
  });

  it("fails closed when an applied SQLite migration file hash changes", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "modeltruth-db-hash-drift-"));
    const migrationsDir = path.join(cwd, "migrations");
    mkdirSync(migrationsDir);
    const migrationPath = path.join(migrationsDir, "000_init_schema_consolidated.sql");
    writeFileSync(migrationPath, "create table users (id text primary key);");

    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    await ensureSqliteReady({ cwd, databasePath });
    writeFileSync(migrationPath, "create table users (id text primary key, email text);");

    await expect(ensureSqliteReady({ cwd, databasePath })).rejects.toThrow("Applied SQLite migration changed");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("upgrades legacy SQLite migration_history before applying pending migrations", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "modeltruth-db-legacy-history-"));
    const migrationsDir = path.join(cwd, "migrations");
    mkdirSync(migrationsDir);
    writeFileSync(path.join(migrationsDir, "000_init_schema_consolidated.sql"), "create table users (id text primary key);");

    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const legacyDb = new DatabaseSync(databasePath);
    legacyDb.exec("create table migration_history (id integer primary key autoincrement, migration_name text not null unique, executed_at text not null)");
    legacyDb.close();

    const result = await ensureSqliteReady({ cwd, databasePath });
    const db = new DatabaseSync(databasePath);
    const columns = db.prepare("pragma table_info(migration_history)").all() as Array<{ name: string }>;
    const migration = db.prepare("select migration_name, file_hash, status from migration_history where migration_name = ?").get("000_init_schema_consolidated.sql") as {
      migration_name: string;
      file_hash: string;
      status: string;
    };
    db.close();
    rmSync(cwd, { recursive: true, force: true });

    expect(result.executed).toBe(1);
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["file_hash", "status", "failed_at", "last_error"]));
    expect(migration.status).toBe("applied");
    expect(migration.file_hash.length).toBe(64);
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
