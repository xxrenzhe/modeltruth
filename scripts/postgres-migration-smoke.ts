import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { ensureDatabaseReady, parsePostgresUrl } from "@modeltruth/db";

type SmokeResult = {
  ok: boolean;
  skipped: boolean;
  message: string;
};

export async function runPostgresMigrationSmoke(env: Record<string, string | undefined> = process.env): Promise<SmokeResult> {
  const databaseUrl = env.MODELTRUTH_POSTGRES_SMOKE_DATABASE_URL;
  const required = env.MODELTRUTH_POSTGRES_SMOKE_REQUIRED === "true";
  if (!databaseUrl) {
    return { ok: !required, skipped: !required, message: required ? "missing DATABASE_URL" : "skipped optional PostgreSQL smoke" };
  }

  const parsed = parsePostgresUrl(withRandomDatabase(databaseUrl));
  const cwd = path.join(tmpdir(), `modeltruth-pg-smoke-${crypto.randomUUID()}`);
  mkdirSync(path.join(cwd, "pg-migrations"), { recursive: true });
  const migrationPath = path.join(cwd, "pg-migrations", "000_init_schema_consolidated.pg.sql");
  writeFileSync(migrationPath, "select pg_sleep(0.25); create table pg_smoke_items (id text primary key);");

  try {
    const results = await Promise.all([
      ensureDatabaseReady({ cwd, databaseUrl: parsed.databaseUrl }),
      ensureDatabaseReady({ cwd, databaseUrl: parsed.databaseUrl })
    ]);
    const executed = results.map((result) => result.executed).sort();
    if (executed.join(",") !== "0,1") throw new Error(`expected one concurrent migration executor, got ${executed.join(",")}`);

    await assertHistoryAndHashDrift(cwd, migrationPath, parsed.databaseUrl);
    return { ok: true, skipped: false, message: `PostgreSQL migrations applied under advisory lock for ${parsed.dbName}` };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    await dropSmokeDatabase(parsed);
  }
}

function withRandomDatabase(databaseUrl: string) {
  const parsed = parsePostgresUrl(databaseUrl);
  const url = new URL(parsed.databaseUrl);
  url.pathname = `/modeltruth_smoke_${crypto.randomUUID().replaceAll("-", "_")}`;
  return url.toString();
}

async function assertHistoryAndHashDrift(cwd: string, migrationPath: string, databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ migrationName: string; fileHash: string; status: string }[]>`
      select migration_name as "migrationName", file_hash as "fileHash", status
      from migration_history
      where migration_name = '000_init_schema_consolidated.pg.sql'
    `;
    if (rows.length !== 1 || rows[0]?.status !== "applied" || rows[0]?.fileHash.length !== 64) {
      throw new Error("migration_history did not record applied PostgreSQL migration hash");
    }
  } finally {
    await sql.end();
  }

  writeFileSync(migrationPath, "create table pg_smoke_items (id text primary key, drift text);");
  await expectPostgresHashDrift(cwd, databaseUrl);
}

async function expectPostgresHashDrift(cwd: string, databaseUrl: string) {
  try {
    await ensureDatabaseReady({ cwd, databaseUrl });
  } catch (error) {
    if (String(error).includes("Applied PostgreSQL migration changed")) return;
    throw error;
  }
  throw new Error("expected PostgreSQL migration hash drift to fail closed");
}

async function dropSmokeDatabase(parsed: ReturnType<typeof parsePostgresUrl>) {
  const adminSql = postgres(parsed.serverUrl, { max: 1 });
  try {
    await adminSql.unsafe(`drop database if exists ${quoteIdentifier(parsed.dbName)} with (force)`);
  } finally {
    await adminSql.end();
  }
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function main() {
  const result = await runPostgresMigrationSmoke();
  const prefix = result.ok ? "[postgres-migration-smoke] passed" : "[postgres-migration-smoke] failed";
  const skipped = result.skipped ? " (optional)" : "";
  console.log(`${prefix}${skipped}: ${result.message}`);
  if (!result.ok) process.exit(1);
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error("[postgres-migration-smoke] failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
