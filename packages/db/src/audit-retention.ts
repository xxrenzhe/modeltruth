import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface AuditRetentionResult {
  deletedAggregateRuns: number;
  deletedAggregateEvidencePackages: number;
  deletedFreePlaygroundRuns: number;
  deletedFreePlaygroundEvidencePackages: number;
  redactedPrivateEvidenceRuns: number;
  redactedPrivateEvidencePackages: number;
}

export interface ApplyAuditRetentionOptions {
  now?: Date;
  freePlaygroundRetentionHours?: number;
  privateEvidenceRetentionDays?: number;
  aggregateRetentionDays?: number;
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
      return await applyPostgresRetention(sql, { aggregateCutoff, playgroundCutoff, privateEvidenceCutoff });
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    return applySqliteRetention(db, { aggregateCutoff, playgroundCutoff, privateEvidenceCutoff });
  } finally {
    db.close();
  }
}

async function applyPostgresRetention(sql: postgres.Sql, cutoffs: RetentionCutoffs): Promise<AuditRetentionResult> {
  const aggregateEvidence = await sql`delete from evidence_packages where created_at < ${cutoffs.aggregateCutoff}`;
  const aggregate = await sql`delete from audit_runs where created_at < ${cutoffs.aggregateCutoff}`;
  const playgroundEvidence = await sql`
    delete from evidence_packages ep
    using audit_runs ar
    where ep.run_id = ar.id
      and ar.run_type = 'playground'
      and ar.workspace_id is null
      and ar.created_at < ${cutoffs.playgroundCutoff}
  `;
  const playground = await sql`
    delete from audit_runs
    where run_type = 'playground' and workspace_id is null and created_at < ${cutoffs.playgroundCutoff}
  `;
  const retentionSummary = retentionRedactedEvidenceSummary(cutoffs.privateEvidenceCutoff);
  const privateEvidence = await sql`
    update audit_runs
    set assertions_json = '[]'::jsonb,
        evidence_summary_json = ${sql.json(retentionSummary as any)}
    where workspace_id is not null
      and created_at < ${cutoffs.privateEvidenceCutoff}
      and created_at >= ${cutoffs.aggregateCutoff}
      and (assertions_json <> '[]'::jsonb or evidence_summary_json->>'retentionRedacted' is distinct from 'true')
  `;
  const privateEvidencePackages = await sql`
    update evidence_packages ep
    set redacted_summary_json = ${sql.json(retentionSummary as any)}
    from audit_runs ar
    where ep.run_id = ar.id
      and ar.workspace_id is not null
      and ep.created_at < ${cutoffs.privateEvidenceCutoff}
      and ep.created_at >= ${cutoffs.aggregateCutoff}
      and ep.redacted_summary_json->>'retentionRedacted' is distinct from 'true'
  `;
  return retentionResult(aggregate.count, aggregateEvidence.count, playground.count, playgroundEvidence.count, privateEvidence.count, privateEvidencePackages.count);
}

function applySqliteRetention(db: { prepare(sql: string): any }, cutoffs: RetentionCutoffs): AuditRetentionResult {
  const aggregateEvidence = db.prepare("delete from evidence_packages where created_at < ?").run(cutoffs.aggregateCutoff);
  const aggregate = db.prepare("delete from audit_runs where created_at < ?").run(cutoffs.aggregateCutoff);
  const playgroundEvidence = db
    .prepare(
      `delete from evidence_packages
       where run_id in (
         select id from audit_runs
         where run_type = 'playground' and workspace_id is null and created_at < ?
       )`
    )
    .run(cutoffs.playgroundCutoff);
  const playground = db
    .prepare("delete from audit_runs where run_type = 'playground' and workspace_id is null and created_at < ?")
    .run(cutoffs.playgroundCutoff);
  const retentionSummaryJson = JSON.stringify(retentionRedactedEvidenceSummary(cutoffs.privateEvidenceCutoff));
  const privateEvidence = db
    .prepare(
      `update audit_runs
       set assertions_json = '[]', evidence_summary_json = ?
       where workspace_id is not null
         and created_at < ?
         and created_at >= ?
         and (assertions_json != '[]' or json_extract(evidence_summary_json, '$.retentionRedacted') is not 1)`
    )
    .run(retentionSummaryJson, cutoffs.privateEvidenceCutoff, cutoffs.aggregateCutoff);
  const privateEvidencePackages = db
    .prepare(
      `update evidence_packages
       set redacted_summary_json = ?
       where run_id in (
         select id from audit_runs
         where workspace_id is not null
           and created_at < ?
           and created_at >= ?
       )
         and created_at < ?
         and created_at >= ?
         and json_extract(redacted_summary_json, '$.retentionRedacted') is not 1`
    )
    .run(retentionSummaryJson, cutoffs.privateEvidenceCutoff, cutoffs.aggregateCutoff, cutoffs.privateEvidenceCutoff, cutoffs.aggregateCutoff);
  return retentionResult(
    aggregate.changes,
    aggregateEvidence.changes,
    playground.changes,
    playgroundEvidence.changes,
    privateEvidence.changes,
    privateEvidencePackages.changes
  );
}

function retentionResult(
  deletedAggregateRuns: number,
  deletedAggregateEvidencePackages: number,
  deletedFreePlaygroundRuns: number,
  deletedFreePlaygroundEvidencePackages: number,
  redactedPrivateEvidenceRuns: number,
  redactedPrivateEvidencePackages: number
) {
  return {
    deletedAggregateRuns: Number(deletedAggregateRuns),
    deletedAggregateEvidencePackages: Number(deletedAggregateEvidencePackages),
    deletedFreePlaygroundRuns: Number(deletedFreePlaygroundRuns),
    deletedFreePlaygroundEvidencePackages: Number(deletedFreePlaygroundEvidencePackages),
    redactedPrivateEvidenceRuns: Number(redactedPrivateEvidenceRuns),
    redactedPrivateEvidencePackages: Number(redactedPrivateEvidencePackages)
  };
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

type RetentionCutoffs = {
  aggregateCutoff: string;
  playgroundCutoff: string;
  privateEvidenceCutoff: string;
};
