import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";
import type { DatabaseType } from "@modeltruth/db";
import { detectDatabaseType } from "@modeltruth/db";

type MigrationFile = {
  number: string;
  name: string;
  fileName: string;
  fileHash: string;
  sql: string;
};

type MigrationHistoryRow = {
  migrationName: string;
  fileHash: string;
  status?: string;
  executedAt?: string;
  failedAt?: string;
  lastError?: string;
};

type MigrationCheckOptions = {
  cwd: string;
  databaseType: DatabaseType;
  databasePath?: string;
  databaseUrl?: string;
};

type MigrationCheckResult = {
  ok: boolean;
  checked: number;
  issues: string[];
};

type MigrationManifest = {
  schemaVersion?: string;
  migrations?: MigrationManifestRecord[];
};

type MigrationManifestRecord = {
  number?: string;
  name?: string;
  sqliteMigration?: string;
  postgresMigration?: string;
  impactQueries?: string[];
  rollback?: {
    sqlite?: string;
    postgres?: string;
  };
  validationSql?: {
    sqlite?: string;
    postgres?: string;
  };
  productionExecutionRecord?: string;
};

const destructivePatterns = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\balter\s+table\b[\s\S]*\bdrop\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i
];

export async function runFinalMigrationCheck(options: MigrationCheckOptions): Promise<MigrationCheckResult> {
  const sqliteMigrations = readMigrationFiles(path.join(options.cwd, "migrations"), ".sql");
  const postgresMigrations = readMigrationFiles(path.join(options.cwd, "pg-migrations"), ".pg.sql");
  const issues = [
    ...validateMigrationPairs(sqliteMigrations, postgresMigrations),
    ...validateMigrationSequence(sqliteMigrations, "SQLite"),
    ...validateMigrationSequence(postgresMigrations, "PostgreSQL"),
    ...validateDestructiveMigrationDiscipline(sqliteMigrations, "SQLite"),
    ...validateDestructiveMigrationDiscipline(postgresMigrations, "PostgreSQL"),
    ...validateMigrationManifest(options.cwd, sqliteMigrations, postgresMigrations)
  ];

  const expected = options.databaseType === "postgres" ? postgresMigrations : sqliteMigrations;
  const history =
    options.databaseType === "postgres"
      ? await readPostgresHistory(options.databaseUrl)
      : await readSqliteHistory(options.databasePath);
  issues.push(...validateHistory(expected, history, options.databaseType));

  return { ok: issues.length === 0, checked: expected.length, issues };
}

function readMigrationFiles(directory: string, extension: ".sql" | ".pg.sql"): MigrationFile[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(extension))
    .filter((fileName) => (extension === ".pg.sql" ? true : !fileName.endsWith(".pg.sql")))
    .sort()
    .map((fileName) => {
      const match = /^(\d{3})_(.+?)(?:\.pg)?\.sql$/.exec(fileName);
      const sql = readFileSync(path.join(directory, fileName), "utf8");
      return {
        number: match?.[1] ?? "invalid",
        name: match?.[2] ?? fileName,
        fileName,
        fileHash: createHash("sha256").update(sql).digest("hex"),
        sql
      };
    });
}

function validateMigrationPairs(sqliteMigrations: MigrationFile[], postgresMigrations: MigrationFile[]) {
  const issues: string[] = [];
  const sqliteByNumber = new Map(sqliteMigrations.map((migration) => [migration.number, migration]));
  const postgresByNumber = new Map(postgresMigrations.map((migration) => [migration.number, migration]));
  const numbers = new Set([...sqliteByNumber.keys(), ...postgresByNumber.keys()]);

  for (const number of [...numbers].sort()) {
    const sqlite = sqliteByNumber.get(number);
    const pg = postgresByNumber.get(number);
    if (!sqlite) issues.push(`Missing SQLite migration paired with PostgreSQL ${pg?.fileName}`);
    if (!pg) issues.push(`Missing PostgreSQL migration paired with SQLite ${sqlite?.fileName}`);
    if (sqlite && pg && sqlite.name !== pg.name) {
      issues.push(`Migration ${number} pair name mismatch: ${sqlite.fileName} vs ${pg.fileName}`);
    }
  }
  return issues;
}

function validateMigrationSequence(migrations: MigrationFile[], label: string) {
  const issues: string[] = [];
  migrations.forEach((migration, index) => {
    const expected = String(index).padStart(3, "0");
    if (!/^\d{3}$/.test(migration.number)) {
      issues.push(`${label} migration has invalid file name: ${migration.fileName}`);
    } else if (migration.number !== expected) {
      issues.push(`${label} migration sequence expected ${expected}, found ${migration.fileName}`);
    }
  });
  return issues;
}

function validateDestructiveMigrationDiscipline(migrations: MigrationFile[], label: string) {
  const issues: string[] = [];
  for (const migration of migrations) {
    const destructive = destructivePatterns.some((pattern) => pattern.test(migration.sql));
    if (!destructive) continue;
    if (!/DESTRUCTIVE MIGRATION/i.test(migration.sql)) {
      issues.push(`${label} ${migration.fileName} uses destructive DDL/DML without DESTRUCTIVE MIGRATION marker`);
    }
    if (!/ROLLBACK:/i.test(migration.sql)) {
      issues.push(`${label} ${migration.fileName} uses destructive DDL/DML without ROLLBACK notes`);
    }
    if (!/VALIDATION:/i.test(migration.sql)) {
      issues.push(`${label} ${migration.fileName} uses destructive DDL/DML without VALIDATION notes`);
    }
  }
  return issues;
}

function validateMigrationManifest(root: string, sqliteMigrations: MigrationFile[], postgresMigrations: MigrationFile[]) {
  const manifestPath = path.join(root, "migrations", "migration-manifest.json");
  if (!existsSync(manifestPath)) return ["missing migrations/migration-manifest.json"];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MigrationManifest;
  const issues: string[] = [];
  if (manifest.schemaVersion !== "modeltruth.migration-manifest.v1") {
    issues.push("migration-manifest.json has unsupported schemaVersion");
  }

  const records = new Map((manifest.migrations ?? []).map((record) => [record.number, record]));
  const postgresByNumber = new Map(postgresMigrations.map((migration) => [migration.number, migration]));
  for (const sqlite of sqliteMigrations) {
    const postgresMigration = postgresByNumber.get(sqlite.number);
    const record = records.get(sqlite.number);
    if (!record) {
      issues.push(`migration ${sqlite.number} missing manifest record`);
      continue;
    }
    if (record.name !== sqlite.name) issues.push(`migration ${sqlite.number} manifest name mismatch`);
    if (record.sqliteMigration !== sqlite.fileName) issues.push(`migration ${sqlite.number} manifest sqliteMigration mismatch`);
    if (postgresMigration && record.postgresMigration !== postgresMigration.fileName) {
      issues.push(`migration ${sqlite.number} manifest postgresMigration mismatch`);
    }
    if (!hasNonEmptyList(record.impactQueries)) issues.push(`migration ${sqlite.number} manifest missing impactQueries`);
    if (!record.rollback?.sqlite?.trim()) issues.push(`migration ${sqlite.number} manifest missing rollback.sqlite`);
    if (!record.rollback?.postgres?.trim()) issues.push(`migration ${sqlite.number} manifest missing rollback.postgres`);
    if (!record.validationSql?.sqlite?.trim()) issues.push(`migration ${sqlite.number} manifest missing validationSql.sqlite`);
    if (!record.validationSql?.postgres?.trim()) issues.push(`migration ${sqlite.number} manifest missing validationSql.postgres`);
    if (!record.productionExecutionRecord?.trim()) issues.push(`migration ${sqlite.number} manifest missing productionExecutionRecord`);
  }

  const expectedNumbers = new Set(sqliteMigrations.map((migration) => migration.number));
  for (const record of manifest.migrations ?? []) {
    if (!record.number || !expectedNumbers.has(record.number)) {
      issues.push(`migration-manifest.json references unknown migration number: ${record.number ?? "missing"}`);
    }
  }
  return issues;
}

function hasNonEmptyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0);
}

async function readSqliteHistory(databasePath: string | undefined): Promise<MigrationHistoryRow[]> {
  if (!databasePath || !existsSync(databasePath)) return [];
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(databasePath);
  try {
    return db
      .prepare(
        `select migration_name as migrationName, file_hash as fileHash, executed_at as executedAt
                , status, failed_at as failedAt, last_error as lastError
         from migration_history
         order by migration_name`
      )
      .all() as MigrationHistoryRow[];
  } finally {
    db.close();
  }
}

async function readPostgresHistory(databaseUrl: string | undefined): Promise<MigrationHistoryRow[]> {
  if (!databaseUrl) return [];
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await sql<MigrationHistoryRow[]>`
      select migration_name as "migrationName", file_hash as "fileHash", status,
             executed_at::text as "executedAt", failed_at::text as "failedAt", last_error as "lastError"
      from migration_history
      order by migration_name
    `;
  } finally {
    await sql.end();
  }
}

function validateHistory(expected: MigrationFile[], history: MigrationHistoryRow[], databaseType: DatabaseType) {
  const issues: string[] = [];
  const historyByName = new Map(history.map((row) => [row.migrationName, row]));
  for (const migration of expected) {
    const row = historyByName.get(migration.fileName);
    if (!row) {
      issues.push(`${databaseType} migration has not been applied: ${migration.fileName}`);
    } else if (row.status && row.status !== "applied") {
      issues.push(`${databaseType} migration is not applied: ${migration.fileName} status=${row.status} error=${row.lastError ?? "unknown"}`);
    } else if (row.fileHash !== migration.fileHash) {
      issues.push(`${databaseType} migration hash mismatch: ${migration.fileName}`);
    } else if (!row.executedAt) {
      issues.push(`${databaseType} migration missing executed_at: ${migration.fileName}`);
    }
  }

  const expectedNames = new Set(expected.map((migration) => migration.fileName));
  for (const row of history) {
    if (!expectedNames.has(row.migrationName)) {
      issues.push(`${databaseType} migration_history contains unknown file: ${row.migrationName}`);
    }
  }
  return issues;
}

async function main() {
  const config = getAppConfig();
  const databaseType = detectDatabaseType(config.databaseUrl);
  const result = await runFinalMigrationCheck({
    cwd: process.cwd(),
    databaseType,
    databasePath: config.databasePath,
    databaseUrl: config.databaseUrl
  });

  if (!result.ok) {
    console.error(`[final-migration-check] failed after checking ${result.checked} ${databaseType} migrations`);
    result.issues.forEach((issue) => console.error(`- ${issue}`));
    process.exit(1);
  }
  console.log(`[final-migration-check] passed: ${result.checked} ${databaseType} migrations match migration_history`);
}

function isExecutedDirectly() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isExecutedDirectly()) {
  main().catch((error) => {
    console.error("[final-migration-check] failed", error);
    process.exit(1);
  });
}
