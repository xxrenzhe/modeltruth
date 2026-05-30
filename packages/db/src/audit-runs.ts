import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface EvidencePackage {
  runId: string;
  suiteId: string;
  suiteVersion: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  metrics: unknown;
  assertions: unknown;
  evidenceSummary: unknown;
  createdAt: string;
}

export interface AuditRunListItem {
  runId: string;
  workspaceId?: string;
  nodeId?: string;
  suiteId: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  metrics: unknown;
  evidenceSummary: unknown;
  createdAt: string;
}

export interface PublicAuditSummary {
  totalRuns: number;
  passRate: number;
  errorRate: number;
  p50TtftMs?: number;
  p95TtftMs?: number;
  riskFlags: AuditRunListItem[];
}

export interface SaveAuditRunInput {
  id: string;
  workspaceId?: string;
  nodeId?: string;
  suiteId: string;
  suiteVersion: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  metrics: unknown;
  assertions: unknown;
  evidenceSummary: unknown;
}

export async function saveAuditRun(input: SaveAuditRunInput): Promise<void> {
  const config = getAppConfig();
  const createdAt = new Date().toISOString();
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      await sql`
        insert into audit_runs (
          id, workspace_id, node_id, suite_id, suite_version, run_type, target_model_id, status, confidence,
          started_at, finished_at, error_code, error_message, metrics_json, assertions_json, evidence_summary_json, created_at
        ) values (
          ${input.id}, ${input.workspaceId ?? null}, ${input.nodeId ?? null}, ${input.suiteId}, ${input.suiteVersion},
          ${input.runType}, ${input.targetModelId}, ${input.status}, ${input.confidence ?? null}, ${input.startedAt ?? null},
          ${input.finishedAt ?? null}, ${input.errorCode ?? null}, ${input.errorMessage ?? null}, ${sql.json(input.metrics as any)},
          ${sql.json(input.assertions as any)}, ${sql.json(input.evidenceSummary as any)}, ${createdAt}
        )
      `;
    } finally {
      await sql.end();
    }
    return;
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    db.prepare(
      `insert into audit_runs (
        id, workspace_id, node_id, suite_id, suite_version, run_type, target_model_id, status, confidence,
        started_at, finished_at, error_code, error_message, metrics_json, assertions_json, evidence_summary_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.workspaceId ?? null,
      input.nodeId ?? null,
      input.suiteId,
      input.suiteVersion,
      input.runType,
      input.targetModelId,
      input.status,
      input.confidence ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      JSON.stringify(input.metrics),
      JSON.stringify(input.assertions),
      JSON.stringify(input.evidenceSummary),
      createdAt
    );
  } finally {
    db.close();
  }
}

export async function getEvidencePackage(runId: string): Promise<EvidencePackage | undefined> {
  const config = getAppConfig();
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      const rows = await sql<EvidenceRow[]>`select * from audit_runs where id = ${runId} limit 1`;
      return rows[0] ? mapEvidenceRow(rows[0]) : undefined;
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    const row = db.prepare("select * from audit_runs where id = ? limit 1").get(runId) as EvidenceRow | undefined;
    return row ? mapEvidenceRow(row) : undefined;
  } finally {
    db.close();
  }
}

export async function listAuditRuns(options: { workspaceId?: string; limit?: number } = {}): Promise<AuditRunListItem[]> {
  const config = getAppConfig();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      const rows = options.workspaceId
        ? await sql<AuditRunListRow[]>`
            select * from audit_runs where workspace_id = ${options.workspaceId}
            order by created_at desc limit ${limit}
          `
        : await sql<AuditRunListRow[]>`select * from audit_runs order by created_at desc limit ${limit}`;
      return rows.map(mapAuditRunListRow);
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    const rows = options.workspaceId
      ? (db
          .prepare("select * from audit_runs where workspace_id = ? order by created_at desc limit ?")
          .all(options.workspaceId, limit) as unknown as AuditRunListRow[])
      : (db.prepare("select * from audit_runs order by created_at desc limit ?").all(limit) as unknown as AuditRunListRow[]);
    return rows.map(mapAuditRunListRow);
  } finally {
    db.close();
  }
}

export async function getPublicAuditSummary(): Promise<PublicAuditSummary> {
  const runs = await listAuditRuns({ limit: 100 });
  const totalRuns = runs.length;
  const passCount = runs.filter((run) => run.status === "pass").length;
  const errorCount = runs.filter((run) => ["fail", "error", "warning"].includes(run.status)).length;
  const ttfts = runs
    .map((run) => metricNumber(run.metrics, "ttftMs"))
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  return {
    totalRuns,
    passRate: totalRuns ? passCount / totalRuns : 0,
    errorRate: totalRuns ? errorCount / totalRuns : 0,
    p50TtftMs: percentile(ttfts, 0.5),
    p95TtftMs: percentile(ttfts, 0.95),
    riskFlags: runs.filter((run) => ["fail", "error", "warning"].includes(run.status)).slice(0, 10)
  };
}

interface EvidenceRow {
  id: string;
  suite_id: string;
  suite_version: string;
  run_type: string;
  target_model_id: string;
  status: string;
  confidence?: number;
  metrics_json: string | object;
  assertions_json: string | object;
  evidence_summary_json: string | object;
  created_at: string;
}

interface AuditRunListRow extends EvidenceRow {
  workspace_id?: string;
  node_id?: string;
}

function mapEvidenceRow(row: EvidenceRow): EvidencePackage {
  return {
    runId: row.id,
    suiteId: row.suite_id,
    suiteVersion: row.suite_version,
    runType: row.run_type,
    targetModelId: row.target_model_id,
    status: row.status,
    confidence: row.confidence,
    metrics: parseJson(row.metrics_json),
    assertions: parseJson(row.assertions_json),
    evidenceSummary: parseJson(row.evidence_summary_json),
    createdAt: row.created_at
  };
}

function parseJson(value: string | object): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function mapAuditRunListRow(row: AuditRunListRow): AuditRunListItem {
  return {
    runId: row.id,
    workspaceId: row.workspace_id,
    nodeId: row.node_id,
    suiteId: row.suite_id,
    runType: row.run_type,
    targetModelId: row.target_model_id,
    status: row.status,
    confidence: row.confidence,
    metrics: parseJson(row.metrics_json),
    evidenceSummary: parseJson(row.evidence_summary_json),
    createdAt: row.created_at
  };
}

function metricNumber(metrics: unknown, key: string): number | undefined {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return undefined;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}
