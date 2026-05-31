import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "@modeltruth/db";
import { runFinalMigrationCheck } from "./final-migration-check";

describe("runFinalMigrationCheck", () => {
  it("passes when paired migrations are applied and hashes match", async () => {
    const cwd = mkProject();
    writeMigrationPair(cwd, "000_init_schema_consolidated", "create table users (id text primary key);");
    writeManifest(cwd, [{ number: "000", name: "init_schema_consolidated" }]);
    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");

    await ensureSqliteReady({ cwd, databasePath });
    const result = await runFinalMigrationCheck({ cwd, databaseType: "sqlite", databasePath });
    rmSync(cwd, { recursive: true, force: true });

    expect(result).toEqual({ ok: true, checked: 1, issues: [] });
  });

  it("fails when an applied migration file changes after execution", async () => {
    const cwd = mkProject();
    writeMigrationPair(cwd, "000_init_schema_consolidated", "create table users (id text primary key);");
    writeManifest(cwd, [{ number: "000", name: "init_schema_consolidated" }]);
    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");

    await ensureSqliteReady({ cwd, databasePath });
    writeFileSync(path.join(cwd, "migrations", "000_init_schema_consolidated.sql"), "create table users (id text);");
    const result = await runFinalMigrationCheck({ cwd, databaseType: "sqlite", databasePath });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("sqlite migration hash mismatch: 000_init_schema_consolidated.sql");
  });

  it("fails when SQLite and PostgreSQL migration pairs diverge", async () => {
    const cwd = mkProject();
    writeFileSync(path.join(cwd, "migrations", "000_init_schema_consolidated.sql"), "create table users (id text);");
    writeFileSync(path.join(cwd, "pg-migrations", "000_different_name.pg.sql"), "create table users (id text);");
    writeManifest(cwd, [{ number: "000", name: "init_schema_consolidated", postgresMigration: "000_different_name.pg.sql" }]);
    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    await ensureSqliteReady({ cwd, databasePath });

    const result = await runFinalMigrationCheck({ cwd, databaseType: "sqlite", databasePath });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "Migration 000 pair name mismatch: 000_init_schema_consolidated.sql vs 000_different_name.pg.sql"
    );
  });

  it("fails when migration review metadata is incomplete", async () => {
    const cwd = mkProject();
    writeMigrationPair(cwd, "000_init_schema_consolidated", "create table users (id text primary key);");
    writeFileSync(
      path.join(cwd, "migrations", "migration-manifest.json"),
      JSON.stringify({
        schemaVersion: "modeltruth.migration-manifest.v1",
        migrations: [{ number: "000", name: "init_schema_consolidated" }]
      })
    );
    const databasePath = path.join(cwd, "data", "modeltruth.sqlite");
    await ensureSqliteReady({ cwd, databasePath });

    const result = await runFinalMigrationCheck({ cwd, databaseType: "sqlite", databasePath });
    rmSync(cwd, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("migration 000 manifest missing impactQueries");
    expect(result.issues).toContain("migration 000 manifest missing rollback.sqlite");
    expect(result.issues).toContain("migration 000 manifest missing validationSql.postgres");
    expect(result.issues).toContain("migration 000 manifest missing productionExecutionRecord");
  });
});

function mkProject() {
  const cwd = path.join(tmpdir(), `modeltruth-final-migration-${crypto.randomUUID()}`);
  mkdirSync(path.join(cwd, "migrations"), { recursive: true });
  mkdirSync(path.join(cwd, "pg-migrations"), { recursive: true });
  return cwd;
}

function writeMigrationPair(cwd: string, name: string, sql: string) {
  writeFileSync(path.join(cwd, "migrations", `${name}.sql`), sql);
  writeFileSync(path.join(cwd, "pg-migrations", `${name}.pg.sql`), sql);
}

function writeManifest(
  cwd: string,
  records: Array<{ number: string; name: string; sqliteMigration?: string; postgresMigration?: string }>
) {
  writeFileSync(
    path.join(cwd, "migrations", "migration-manifest.json"),
    JSON.stringify(
      {
        schemaVersion: "modeltruth.migration-manifest.v1",
        migrations: records.map((record) => ({
          number: record.number,
          name: record.name,
          sqliteMigration: record.sqliteMigration ?? `${record.number}_${record.name}.sql`,
          postgresMigration: record.postgresMigration ?? `${record.number}_${record.name}.pg.sql`,
          impactQueries: ["repository integration paths for this schema change"],
          rollback: {
            sqlite: "append a forward rollback migration; do not edit applied migration files",
            postgres: "append a forward rollback migration; do not edit applied migration files"
          },
          validationSql: {
            sqlite: "select 1",
            postgres: "select 1"
          },
          productionExecutionRecord: "Pending first production deployment; db:final-check records applied hash before release."
        }))
      },
      null,
      2
    )
  );
}
