import postgres from "postgres";
import { checkDatabaseHealth } from "@modeltruth/db";
import { getAppConfig } from "@modeltruth/config";

const criticalTables = [
  "users",
  "workspaces",
  "provider_nodes",
  "jobs",
  "audit_runs",
  "alert_channels",
  "content_pages",
  "model_registry",
  "model_calibrations",
  "provider_subscriptions",
  "risk_flags",
  "risk_flag_events",
  "evidence_packages",
  "migration_history"
];

const criticalColumns: Record<string, string[]> = {
  workspaces: ["tier", "stripe_customer_id", "stripe_subscription_id", "subscription_status"],
  provider_nodes: ["workspace_id", "base_url_host_hash", "encrypted_api_key", "api_key_suffix", "deleted_at", "ttft_threshold_ms"],
  jobs: ["type", "status", "payload_json", "attempts", "max_attempts", "run_after", "locked_at", "locked_by", "last_error"],
  audit_runs: ["trace_id", "provider_slug", "workspace_id", "node_id", "suite_id", "suite_version", "metrics_json", "evidence_summary_json"],
  alert_channels: ["workspace_id", "type", "encrypted_target", "target_suffix"],
  content_pages: ["locale", "type", "slug", "title", "description", "canonical_slug", "no_index"],
  model_registry: ["provider", "model_id", "status", "baseline_suite_version", "last_calibrated_at"],
  provider_disputes: ["provider_slug", "request_type", "status", "review_due_at", "review_started_at"],
  workspace_members: ["workspace_id", "email", "role", "status"],
  workspace_privacy_settings: ["workspace_id", "save_full_responses"],
  byo_probes: ["workspace_id", "region", "token_hash", "status", "last_seen_at"],
  provider_subscriptions: ["provider_slug", "email", "notification_type", "status"],
  risk_flags: ["workspace_id", "node_id", "provider_slug", "assertion_id", "severity", "status", "evidence_count"],
  risk_flag_events: ["risk_flag_id", "event_type", "from_status", "to_status", "run_id", "evidence_package_id"],
  evidence_packages: ["run_id", "provider_slug", "risk_flag_id", "redacted_summary_json"]
};

const criticalIndexes = [
  "idx_jobs_status_run_after",
  "idx_provider_nodes_workspace_status",
  "idx_audit_runs_node_created",
  "idx_audit_runs_provider_created",
  "idx_audit_runs_trace_id",
  "idx_playground_quota_key_created",
  "idx_model_registry_provider_model",
  "idx_model_calibrations_model_time",
  "idx_provider_disputes_provider_status",
  "idx_provider_disputes_review_due",
  "idx_provider_disputes_request_type",
  "idx_workspace_members_workspace_status",
  "idx_byo_probes_token_hash",
  "idx_provider_subscriptions_provider_status",
  "idx_risk_flags_provider_status",
  "idx_risk_flags_workspace_node_assertion",
  "idx_risk_flag_events_flag_created",
  "idx_evidence_packages_run"
];

const health = await checkDatabaseHealth();
if (!health.ok) {
  console.error("[validate-db-schema] database health failed", health);
  process.exit(1);
}
await validateSchemaCompleteness();

console.log("[validate-db-schema] database health passed", health);

async function validateSchemaCompleteness() {
  const config = getAppConfig();
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      const rows = await sql<{ table_name: string }[]>`
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_name in ${sql(criticalTables)}
      `;
      assertAllTables(rows.map((row) => row.table_name));
      await validatePostgresColumns(sql);
      await validatePostgresIndexes(sql);
      await validatePostgresBusinessConfig(sql);
    } finally {
      await sql.end();
    }
    return;
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    const rows = db
      .prepare(`select name from sqlite_master where type = 'table' and name in (${criticalTables.map(() => "?").join(",")})`)
      .all(...criticalTables) as Array<{ name: string }>;
    assertAllTables(rows.map((row) => row.name));
    validateSqliteColumns(db);
    validateSqliteIndexes(db);
    validateSqliteBusinessConfig(db);
  } finally {
    db.close();
  }
}

function assertAllTables(existing: string[]) {
  const present = new Set(existing);
  const missing = criticalTables.filter((table) => !present.has(table));
  if (missing.length > 0) {
    console.error(`[validate-db-schema] missing critical tables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function validatePostgresColumns(sql: postgres.Sql) {
  for (const [table, columns] of Object.entries(criticalColumns)) {
    const rows = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name in ${sql(columns)}
    `;
    assertAllColumns(table, columns, rows.map((row) => row.column_name));
  }
}

async function validatePostgresIndexes(sql: postgres.Sql) {
  const rows = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes
    where schemaname = 'public' and indexname in ${sql(criticalIndexes)}
  `;
  assertAllIndexes(rows.map((row) => row.indexname));
}

async function validatePostgresBusinessConfig(sql: postgres.Sql) {
  const rows = await sql<{ baseline: string }[]>`
    select column_default as baseline
    from information_schema.columns
    where table_schema='public' and table_name='model_registry' and column_name='baseline_suite_version'
  `;
  assertBusinessConfig(rows[0]?.baseline);
}

function validateSqliteColumns(db: { prepare(sql: string): any }) {
  for (const [table, columns] of Object.entries(criticalColumns)) {
    const rows = db.prepare(`pragma table_info('${table}')`).all() as Array<{ name: string }>;
    assertAllColumns(table, columns, rows.map((row) => row.name));
  }
}

function validateSqliteIndexes(db: { prepare(sql: string): any }) {
  const rows = db
    .prepare(`select name from sqlite_master where type = 'index' and name in (${criticalIndexes.map(() => "?").join(",")})`)
    .all(...criticalIndexes) as Array<{ name: string }>;
  assertAllIndexes(rows.map((row) => row.name));
}

function validateSqliteBusinessConfig(db: { prepare(sql: string): any }) {
  const rows = db.prepare("pragma table_info('model_registry')").all() as Array<{ name: string; dflt_value?: string }>;
  assertBusinessConfig(rows.find((row) => row.name === "baseline_suite_version")?.dflt_value);
}

function assertAllColumns(table: string, expected: string[], existing: string[]) {
  const present = new Set(existing);
  const missing = expected.filter((column) => !present.has(column));
  if (missing.length > 0) {
    console.error(`[validate-db-schema] missing critical columns on ${table}: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function assertAllIndexes(existing: string[]) {
  const present = new Set(existing);
  const missing = criticalIndexes.filter((index) => !present.has(index));
  if (missing.length > 0) {
    console.error(`[validate-db-schema] missing critical indexes: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function assertBusinessConfig(value: string | undefined) {
  if (!value?.includes("fingerprint-calibration@1.0.0")) {
    console.error("[validate-db-schema] model_registry baseline_suite_version default is missing fingerprint-calibration@1.0.0");
    process.exit(1);
  }
}
