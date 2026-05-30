import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";
import { splitSqlStatements } from "./sql-splitter";

export type DatabaseType = "sqlite" | "postgres";

export interface DatabaseBootstrapOptions {
  cwd?: string;
  databasePath?: string;
  databaseUrl?: string;
}

export interface MigrationRecord {
  migrationName: string;
  fileHash: string;
}

export function detectDatabaseType(databaseUrl = process.env.DATABASE_URL): DatabaseType {
  return databaseUrl ? "postgres" : "sqlite";
}

export async function ensureDatabaseReady(options: DatabaseBootstrapOptions = {}) {
  const config = getAppConfig();
  const cwd = options.cwd ?? process.cwd();
  const databaseUrl = options.databaseUrl ?? config.databaseUrl;
  if (databaseUrl) {
    return ensurePostgresReady({ cwd, databaseUrl });
  }
  return ensureSqliteReady({
    cwd,
    databasePath: options.databasePath ?? config.databasePath
  });
}

export async function checkDatabaseHealth() {
  try {
    const type = detectDatabaseType();
    if (type === "postgres") {
      const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
      await sql`select 1 as ok`;
      await sql.end();
      return { ok: true, type };
    }

    const { DatabaseSync } = await import("node:sqlite");
    const config = getAppConfig();
    if (!existsSync(config.databasePath)) return { ok: false, type, reason: "missing_sqlite_db" };
    const db = new DatabaseSync(config.databasePath);
    db.prepare("select 1 as ok").get();
    db.close();
    return { ok: true, type };
  } catch (error) {
    return { ok: false, type: detectDatabaseType(), reason: String(error) };
  }
}

export async function ensureSqliteReady(options: Required<Pick<DatabaseBootstrapOptions, "cwd" | "databasePath">>) {
  const { DatabaseSync } = await import("node:sqlite");
  const dbDir = path.dirname(options.databasePath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(options.databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(sqliteMigrationHistorySql);

  const migrations = readMigrationFiles(path.join(options.cwd, "migrations"), ".sql");
  for (const migration of migrations) {
    const existing = getSqliteMigration(db, migration.name);
    if (existing?.fileHash === migration.fileHash) continue;
    executeSqliteStatements(db, migration.sql);
    db.prepare(
      `insert into migration_history (migration_name, file_hash, executed_at)
       values (?, ?, datetime('now'))
       on conflict(migration_name) do update set
         file_hash = excluded.file_hash,
         executed_at = datetime('now')`
    ).run(migration.name, migration.fileHash);
  }

  db.close();
  return { type: "sqlite" as const, executed: migrations.length };
}

async function ensurePostgresReady(options: { cwd: string; databaseUrl: string }) {
  const sql = postgres(options.databaseUrl, { max: 1 });
  const lockKey = 2026053101;
  await sql`select pg_advisory_lock(${lockKey})`;

  try {
    await sql.unsafe(postgresMigrationHistorySql);
    const migrations = readMigrationFiles(path.join(options.cwd, "pg-migrations"), ".pg.sql");
    for (const migration of migrations) {
      const rows = await sql<MigrationRecord[]>`
        select migration_name as "migrationName", file_hash as "fileHash"
        from migration_history
        where migration_name = ${migration.name}
      `;
      if (rows[0]?.fileHash === migration.fileHash) continue;

      await sql.begin(async (transaction) => {
        for (const statement of splitSqlStatements(migration.sql)) {
          if (statement.trim()) await transaction.unsafe(statement);
        }
        await transaction`
          insert into migration_history (migration_name, file_hash)
          values (${migration.name}, ${migration.fileHash})
          on conflict (migration_name) do update set
            file_hash = excluded.file_hash,
            executed_at = current_timestamp
        `;
      });
    }
    return { type: "postgres" as const, executed: migrations.length };
  } finally {
    await sql`select pg_advisory_unlock(${lockKey})`;
    await sql.end();
  }
}

function readMigrationFiles(directory: string, extension: ".sql" | ".pg.sql") {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith(extension))
    .filter((file) => (extension === ".pg.sql" ? true : !file.endsWith(".pg.sql")))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(directory, file), "utf-8");
      return { name: file, sql, fileHash: createHash("sha256").update(sql).digest("hex") };
    });
}

function executeSqliteStatements(db: { exec(sql: string): void }, sql: string) {
  db.exec("BEGIN");
  try {
    for (const statement of splitSqlStatements(sql)) {
      if (statement.trim()) db.exec(statement);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getSqliteMigration(
  db: { prepare(sql: string): { get(...params: unknown[]): unknown } },
  migrationName: string
) {
  return db
    .prepare("select migration_name as migrationName, file_hash as fileHash from migration_history where migration_name = ?")
    .get(migrationName) as MigrationRecord | undefined;
}

const sqliteMigrationHistorySql = `
create table if not exists migration_history (
  id integer primary key autoincrement,
  migration_name text not null unique,
  file_hash text not null,
  executed_at text not null default (datetime('now'))
);
`;

const postgresMigrationHistorySql = `
create table if not exists migration_history (
  id serial primary key,
  migration_name text not null unique,
  file_hash text not null,
  executed_at timestamp not null default current_timestamp
);
`;

export { splitSqlStatements };
export type { ClaimJobInput, EnqueueJobInput, JobRecord, JobRepository, JobStatus, JobType } from "./jobs";
export { createJobRepository, SqliteJobRepository } from "./jobs";
