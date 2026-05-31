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
  status: "applied" | "failed";
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
  const config = getAppConfig();
  const type = detectDatabaseType(config.databaseUrl);
  try {
    if (type === "postgres") {
      const sql = postgres(parsePostgresUrl(config.databaseUrl!).databaseUrl, { max: 1 });
      try {
        await sql`select 1 as ok`;
      } finally {
        await sql.end();
      }
      return { ok: true, type };
    }

    const { DatabaseSync } = await import("node:sqlite");
    if (!existsSync(config.databasePath)) return { ok: false, type, reason: "missing_sqlite_db" };
    const db = new DatabaseSync(config.databasePath);
    try {
      db.prepare("select 1 as ok").get();
    } finally {
      db.close();
    }
    return { ok: true, type };
  } catch (error) {
    return { ok: false, type, reason: String(error) };
  }
}

export async function ensureSqliteReady(options: Required<Pick<DatabaseBootstrapOptions, "cwd" | "databasePath">>) {
  const { DatabaseSync } = await import("node:sqlite");
  const dbDir = path.dirname(options.databasePath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(options.databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    ensureSqliteMigrationHistory(db);

    const migrations = readMigrationFiles(path.join(options.cwd, "migrations"), ".sql");
    let executed = 0;
    for (const migration of migrations) {
      const existing = getSqliteMigration(db, migration.name);
      if (existing?.fileHash === migration.fileHash && existing.status === "applied") continue;
      if (existing?.status === "applied" && existing.fileHash !== migration.fileHash) {
        throw new Error(`Applied SQLite migration changed after execution: ${migration.name}`);
      }
      try {
        executeSqliteStatements(db, migration.sql);
        db.prepare(
          `insert into migration_history (migration_name, file_hash, status, executed_at, failed_at, last_error)
           values (?, ?, 'applied', datetime('now'), null, null)
           on conflict(migration_name) do update set
             file_hash = excluded.file_hash,
             status = 'applied',
             executed_at = datetime('now'),
             failed_at = null,
             last_error = null`
        ).run(migration.name, migration.fileHash);
      } catch (error) {
        recordSqliteMigrationFailure(db, migration.name, migration.fileHash, error);
        throw error;
      }
      executed += 1;
    }

    return { type: "sqlite" as const, scanned: migrations.length, executed };
  } finally {
    db.close();
  }
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

    await ensurePostgresMigrationHistory(sql);
    const migrations = readMigrationFiles(path.join(options.cwd, "pg-migrations"), ".pg.sql");
    let executed = 0;
    for (const migration of migrations) {
      const rows = await sql<MigrationRecord[]>`
        select migration_name as "migrationName", file_hash as "fileHash", status
        from migration_history
        where migration_name = ${migration.name}
      `;
      if (rows[0]?.fileHash === migration.fileHash && rows[0]?.status === "applied") continue;
      if (rows[0]?.status === "applied" && rows[0].fileHash !== migration.fileHash) {
        throw new Error(`Applied PostgreSQL migration changed after execution: ${migration.name}`);
      }

      try {
        await sql.begin(async (transaction) => {
          await transaction.unsafe(`set local lock_timeout = '${getPostgresLockTimeoutMs()}ms'`);
          await transaction.unsafe(`set local statement_timeout = '${getPostgresStatementTimeoutMs()}ms'`);
          for (const statement of splitSqlStatements(migration.sql)) {
            if (statement.trim()) await transaction.unsafe(statement);
          }
          await transaction`
            insert into migration_history (migration_name, file_hash, status, executed_at, failed_at, last_error)
            values (${migration.name}, ${migration.fileHash}, 'applied', current_timestamp, null, null)
            on conflict (migration_name) do update set
              file_hash = excluded.file_hash,
              status = 'applied',
              executed_at = current_timestamp,
              failed_at = null,
              last_error = null
          `;
        });
      } catch (error) {
        await recordPostgresMigrationFailure(sql, migration.name, migration.fileHash, error);
        throw error;
      }
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

function getPostgresLockTimeoutMs() {
  return parsePositiveInt(process.env.DB_MIGRATION_LOCK_TIMEOUT_MS, 5000);
}

function getPostgresStatementTimeoutMs() {
  return parsePositiveInt(process.env.DB_MIGRATION_STATEMENT_TIMEOUT_MS, 300000);
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
    .prepare("select migration_name as migrationName, file_hash as fileHash, status from migration_history where migration_name = ?")
    .get(migrationName) as MigrationRecord | undefined;
}

function ensureSqliteMigrationHistory(db: { exec(sql: string): void; prepare(sql: string): { all(): unknown[] } }) {
  db.exec(sqliteMigrationHistorySql);
  const columns = new Set((db.prepare("pragma table_info(migration_history)").all() as Array<{ name: string }>).map((row) => row.name));
  if (!columns.has("file_hash")) db.exec("alter table migration_history add column file_hash text");
  if (!columns.has("status")) db.exec("alter table migration_history add column status text not null default 'applied'");
  if (!columns.has("failed_at")) db.exec("alter table migration_history add column failed_at text");
  if (!columns.has("last_error")) db.exec("alter table migration_history add column last_error text");
}

function recordSqliteMigrationFailure(
  db: { prepare(sql: string): { run(...params: unknown[]): void } },
  migrationName: string,
  fileHash: string,
  error: unknown
) {
  db.prepare(
    `insert into migration_history (migration_name, file_hash, status, executed_at, failed_at, last_error)
     values (?, ?, 'failed', datetime('now'), datetime('now'), ?)
     on conflict(migration_name) do update set
       file_hash = excluded.file_hash,
       status = 'failed',
       executed_at = datetime('now'),
       failed_at = datetime('now'),
       last_error = excluded.last_error`
  ).run(migrationName, fileHash, formatMigrationError(error));
}

async function ensurePostgresMigrationHistory(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(postgresMigrationHistorySql);
  await sql.unsafe(`
    alter table migration_history
      add column if not exists file_hash text,
      add column if not exists status text not null default 'applied',
      add column if not exists failed_at timestamp,
      add column if not exists last_error text
  `);
}

async function recordPostgresMigrationFailure(
  sql: ReturnType<typeof postgres>,
  migrationName: string,
  fileHash: string,
  error: unknown
) {
  await sql`
    insert into migration_history (migration_name, file_hash, status, executed_at, failed_at, last_error)
    values (${migrationName}, ${fileHash}, 'failed', current_timestamp, current_timestamp, ${formatMigrationError(error)})
    on conflict (migration_name) do update set
      file_hash = excluded.file_hash,
      status = 'failed',
      executed_at = current_timestamp,
      failed_at = current_timestamp,
      last_error = excluded.last_error
  `;
}

function formatMigrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

const sqliteMigrationHistorySql = `
create table if not exists migration_history (
  id integer primary key autoincrement,
  migration_name text not null unique,
  file_hash text not null,
  status text not null default 'applied',
  executed_at text not null default (datetime('now')),
  failed_at text,
  last_error text
);
`;

const postgresMigrationHistorySql = `
create table if not exists migration_history (
  id serial primary key,
  migration_name text not null unique,
  file_hash text not null,
  status text not null default 'applied',
  executed_at timestamp not null default current_timestamp,
  failed_at timestamp,
  last_error text
);
`;

export { splitSqlStatements };
export type { ClaimJobInput, EnqueueJobInput, JobRecord, JobRepository, JobStatus, JobType } from "./jobs";
export { createJobRepository, SqliteJobRepository } from "./jobs";
export type {
  ProviderNodeKeyRotationRecord,
  ProviderNodeRecord,
  ProviderNodeRepository,
  ProviderNodeSecretRecord
} from "./provider-nodes";
export { createProviderNodeRepository } from "./provider-nodes";
export type {
  ApplyAuditRetentionOptions,
  AuditRetentionResult,
  AuditRunListItem,
  EvidencePackage,
  SaveAuditRunInput
} from "./audit-runs";
export type { PublicAuditSummary, PublicRiskFlag } from "./public-audit-summary";
export {
  applyAuditRetentionPolicy,
  deleteAuditRun,
  getEvidencePackage,
  getPublicAuditSummary,
  listAuditRuns,
  saveAuditRun
} from "./audit-runs";
export type { MonthlyAuditReport, MonthlyReportGroup } from "./audit-reports";
export { buildMonthlyAuditReport, parseReportMonth } from "./audit-reports";
export type { AuthRepository, AuthSession, AuthUser, AuthWorkspace, MagicLink, PrivacyExport } from "./auth";
export { createAuthRepository } from "./auth";
export type { WorkspaceMemberRecord, WorkspaceMemberRepository, WorkspaceMemberRole, WorkspaceMemberStatus } from "./workspace-members";
export { createWorkspaceMemberRepository } from "./workspace-members";
export type { WorkspacePrivacyRepository, WorkspacePrivacySettings } from "./workspace-privacy";
export { createWorkspacePrivacyRepository } from "./workspace-privacy";
export type { ByoProbeRecord, ByoProbeRepository, ByoProbeStatus, RegisterByoProbeResult } from "./probes";
export { createByoProbeRepository } from "./probes";
export type { BillingRepository, UpdateWorkspaceBillingInput, WorkspaceBilling } from "./billing";
export { createBillingRepository } from "./billing";
export type {
  AlertChannelRecord,
  AlertChannelRepository,
  AlertChannelSecretRecord,
  AlertChannelType,
  CreateAlertChannelInput
} from "./alert-channels";
export { createAlertChannelRepository } from "./alert-channels";
export type {
  CreateProviderDisputeInput,
  ProviderDisputeRecord,
  ProviderDisputeRepository,
  ProviderDisputeStatus
} from "./disputes";
export { createProviderDisputeRepository } from "./disputes";
export type {
  CreateProviderSubscriptionInput,
  ProviderNotificationType,
  ProviderSubscriptionRecord,
  ProviderSubscriptionRepository,
  ProviderSubscriptionStatus
} from "./provider-subscriptions";
export { createProviderSubscriptionRepository } from "./provider-subscriptions";
export type { ContentPageRecord, ContentPageRepository, ContentPageType, UpsertContentPageInput } from "./content-pages";
export { createContentPageRepository } from "./content-pages";
export type { PlaygroundQuotaRepository, PlaygroundQuotaResult } from "./playground-quota";
export { createPlaygroundQuotaRepository } from "./playground-quota";
export type {
  ModelCalibrationRecord,
  ModelRegistryRecord,
  ModelRegistryRepository,
  ModelRegistryStatus,
  RecordModelCalibrationInput,
  UpsertModelRegistryInput
} from "./model-registry";
export { createModelRegistryRepository } from "./model-registry";
export type { PublicTokenUsage } from "./public-usage";
export { normalizePublicUsage } from "./public-usage";
