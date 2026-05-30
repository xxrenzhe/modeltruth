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

export interface DatabaseBootstrapResult {
  type: DatabaseType;
  scanned: number;
  executed: number;
}

export interface MigrationRecord {
  migrationName: string;
  fileHash: string;
}

export interface ParsedPostgresUrl {
  dbName: string;
  databaseUrl: string;
  serverUrl: string;
}

export function detectDatabaseType(databaseUrl = process.env.DATABASE_URL): DatabaseType {
  return databaseUrl ? "postgres" : "sqlite";
}

const postgresConnectionOptions = {
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60,
  max: 1
};

export async function ensureDatabaseReady(options: DatabaseBootstrapOptions = {}): Promise<DatabaseBootstrapResult> {
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
  let executed = 0;
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
    executed += 1;
  }

  db.close();
  return { type: "sqlite" as const, scanned: migrations.length, executed };
}

async function ensurePostgresReady(options: { cwd: string; databaseUrl: string }) {
  const parsed = parsePostgresUrl(options.databaseUrl);
  await ensurePostgresDatabaseExists(parsed);

  const sql = postgres(parsed.databaseUrl, postgresConnectionOptions);
  const lockKey = 2026053101;
  let lockAcquired = false;

  try {
    await waitForPostgres(sql, `database ${parsed.dbName}`);
    await acquirePostgresMigrationLock(sql, lockKey);
    lockAcquired = true;

    await sql.unsafe(postgresMigrationHistorySql);
    const migrations = readMigrationFiles(path.join(options.cwd, "pg-migrations"), ".pg.sql");
    let executed = 0;
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
      executed += 1;
    }
    return { type: "postgres" as const, scanned: migrations.length, executed };
  } finally {
    if (lockAcquired) await sql`select pg_advisory_unlock(${lockKey})`;
    await sql.end();
  }
}

async function ensurePostgresDatabaseExists(parsed: ParsedPostgresUrl) {
  const adminSql = postgres(parsed.serverUrl, postgresConnectionOptions);
  try {
    await waitForPostgres(adminSql, "postgres server");
    const exists = await adminSql`
      select 1 from pg_database where datname = ${parsed.dbName}
    `;
    if (exists.length > 0) return;

    try {
      await adminSql.unsafe(`create database ${quotePostgresIdentifier(parsed.dbName)}`);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (!message.includes("already exists")) throw error;
    }
  } finally {
    await adminSql.end();
  }
}

async function waitForPostgres(sql: ReturnType<typeof postgres>, label: string) {
  const attempts = parsePositiveInt(process.env.DB_STARTUP_CONNECT_RETRIES, 30);
  const delayMs = parsePositiveInt(process.env.DB_STARTUP_CONNECT_RETRY_DELAY_MS, 1000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await sql`select 1`;
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`PostgreSQL ${label} is not ready after ${attempts} attempts: ${String(error)}`);
      }
      await sleep(delayMs);
    }
  }
}

async function acquirePostgresMigrationLock(sql: ReturnType<typeof postgres>, lockKey: number) {
  const attempts = parsePositiveInt(process.env.DB_MIGRATION_LOCK_RETRIES, 60);
  const delayMs = parsePositiveInt(process.env.DB_MIGRATION_LOCK_RETRY_DELAY_MS, 1000);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rows = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(${lockKey}) as locked`;
    if (rows[0]?.locked) return;
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for PostgreSQL migration advisory lock ${lockKey}`);
}

export function parsePostgresUrl(rawUrl: string): ParsedPostgresUrl {
  const normalizedUrl = ensurePostgresProtocol(rawUrl);
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    throw new Error("Invalid DATABASE_URL format");
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "postgres";
  parsed.pathname = "/postgres";
  return { dbName, databaseUrl: normalizedUrl, serverUrl: parsed.toString() };
}

function ensurePostgresProtocol(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (/^postgres(?:ql)?:\/\//i.test(trimmed)) return trimmed;
  return `postgresql://${trimmed}`;
}

function quotePostgresIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
export type { ProviderNodeRecord, ProviderNodeRepository } from "./provider-nodes";
export { createProviderNodeRepository } from "./provider-nodes";
export type { EvidencePackage } from "./audit-runs";
export { getEvidencePackage } from "./audit-runs";
export type { AuthRepository, AuthSession, AuthUser, AuthWorkspace, MagicLink } from "./auth";
export { createAuthRepository } from "./auth";
