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
