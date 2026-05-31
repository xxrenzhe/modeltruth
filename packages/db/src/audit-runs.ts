import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";
import { buildPublicAuditSummary, type PublicAuditSummary } from "./public-audit-summary";

export interface EvidencePackage {
  runId: string;
  traceId?: string;
  providerSlug?: string;
  workspaceId?: string;
  nodeId?: string;
  suiteId: string;
  suiteVersion: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  metrics: unknown;
  assertions?: unknown;
  evidenceSummary: unknown;
  createdAt: string;
}

export interface AuditRunListItem {
  runId: string;
  traceId?: string;
  providerSlug?: string;
  workspaceId?: string;
  nodeId?: string;
  suiteId: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  metrics: unknown;
  assertions?: unknown;
  evidenceSummary: unknown;
  createdAt: string;
}

export interface SaveAuditRunInput {
  id: string;
  traceId?: string;
  providerSlug?: string;
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
  createdAt?: string;
  metrics: unknown;
  assertions: unknown;
  evidenceSummary: unknown;
}

export interface AuditRetentionResult {
  deletedAggregateRuns: number;
  deletedFreePlaygroundRuns: number;
  redactedPrivateEvidenceRuns: number;
}

export interface ApplyAuditRetentionOptions {
  now?: Date;
  freePlaygroundRetentionHours?: number;
  privateEvidenceRetentionDays?: number;
  aggregateRetentionDays?: number;
}

export async function saveAuditRun(input: SaveAuditRunInput): Promise<void> {
  const config = getAppConfig();
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      await sql`
        insert into audit_runs (
          id, trace_id, provider_slug, workspace_id, node_id, suite_id, suite_version, run_type, target_model_id, status, confidence,
          started_at, finished_at, error_code, error_message, metrics_json, assertions_json, evidence_summary_json, created_at
        ) values (
          ${input.id}, ${input.traceId ?? null}, ${input.providerSlug ?? null}, ${input.workspaceId ?? null}, ${input.nodeId ?? null}, ${input.suiteId}, ${input.suiteVersion},
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
        id, trace_id, provider_slug, workspace_id, node_id, suite_id, suite_version, run_type, target_model_id, status, confidence,
        started_at, finished_at, error_code, error_message, metrics_json, assertions_json, evidence_summary_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.traceId ?? null,
      input.providerSlug ?? null,
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

export async function applyAuditRetentionPolicy(options: ApplyAuditRetentionOptions = {}): Promise<AuditRetentionResult> {
  const config = getAppConfig();
  const now = options.now ?? new Date();
  const aggregateCutoff = cutoffIso(now, options.aggregateRetentionDays ?? 365, "days");
  const playgroundCutoff = cutoffIso(now, options.freePlaygroundRetentionHours ?? 24, "hours");
  const privateEvidenceCutoff = cutoffIso(now, options.privateEvidenceRetentionDays ?? 30, "days");

  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      const aggregate = await sql`delete from audit_runs where created_at < ${aggregateCutoff}`;
      const playground = await sql`
        delete from audit_runs
        where run_type = 'playground' and workspace_id is null and created_at < ${playgroundCutoff}
      `;
      const privateEvidence = await sql`
        update audit_runs
        set assertions_json = '[]'::jsonb,
            evidence_summary_json = ${sql.json(retentionRedactedEvidenceSummary(privateEvidenceCutoff) as any)}
        where workspace_id is not null
          and created_at < ${privateEvidenceCutoff}
          and created_at >= ${aggregateCutoff}
          and (assertions_json <> '[]'::jsonb or evidence_summary_json->>'retentionRedacted' is distinct from 'true')
      `;
      return {
        deletedAggregateRuns: aggregate.count,
        deletedFreePlaygroundRuns: playground.count,
        redactedPrivateEvidenceRuns: privateEvidence.count
      };
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    const aggregate = db.prepare("delete from audit_runs where created_at < ?").run(aggregateCutoff);
    const playground = db
      .prepare("delete from audit_runs where run_type = 'playground' and workspace_id is null and created_at < ?")
      .run(playgroundCutoff);
    const privateEvidence = db
      .prepare(
        `update audit_runs
         set assertions_json = '[]', evidence_summary_json = ?
         where workspace_id is not null
           and created_at < ?
           and created_at >= ?
           and (assertions_json != '[]' or json_extract(evidence_summary_json, '$.retentionRedacted') is not 1)`
      )
      .run(JSON.stringify(retentionRedactedEvidenceSummary(privateEvidenceCutoff)), privateEvidenceCutoff, aggregateCutoff);
    return {
      deletedAggregateRuns: Number(aggregate.changes),
      deletedFreePlaygroundRuns: Number(playground.changes),
      redactedPrivateEvidenceRuns: Number(privateEvidence.changes)
    };
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

export async function deleteAuditRun(runId: string): Promise<boolean> {
  const config = getAppConfig();
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      const result = await sql`delete from audit_runs where id = ${runId}`;
      return result.count > 0;
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    const result = db.prepare("delete from audit_runs where id = ?").run(runId);
    return Number(result.changes) > 0;
  } finally {
    db.close();
  }
}

export async function listAuditRuns(options: { workspaceId?: string; limit?: number } = {}): Promise<AuditRunListItem[]> {
  const config = getAppConfig();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 5000);
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

export async function getPublicAuditSummary(options: { providerSlug?: string } = {}): Promise<PublicAuditSummary> {
  const allRuns = await listAuditRuns({ limit: 5000 });
  return buildPublicAuditSummary(allRuns, options.providerSlug);
}

interface EvidenceRow {
  id: string;
  trace_id?: string;
  provider_slug?: string;
  workspace_id?: string;
  node_id?: string;
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
    traceId: row.trace_id,
    providerSlug: row.provider_slug,
    workspaceId: row.workspace_id,
    nodeId: row.node_id,
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

function cutoffIso(now: Date, amount: number, unit: "hours" | "days") {
  const multiplier = unit === "hours" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - amount * multiplier).toISOString();
}

function retentionRedactedEvidenceSummary(cutoff: string) {
  return {
    retentionRedacted: true,
    redactedAtCutoff: cutoff,
    reason: "private evidence retention window expired; aggregate metrics retained"
  };
}

function mapAuditRunListRow(row: AuditRunListRow): AuditRunListItem {
  return {
    runId: row.id,
    traceId: row.trace_id,
    providerSlug: row.provider_slug,
    workspaceId: row.workspace_id,
    nodeId: row.node_id,
    suiteId: row.suite_id,
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
