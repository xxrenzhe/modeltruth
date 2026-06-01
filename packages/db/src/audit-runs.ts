import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";
import { redactSecrets } from "@modeltruth/crypto";
import { buildPublicAuditSummary, type PublicAuditSummary } from "./public-audit-summary";
import { normalizePublicUsage } from "./public-usage";
import { createRiskFlagRepository, type RiskFlagSeverity } from "./risk-flags";
export { applyAuditRetentionPolicy } from "./audit-retention";
export type { ApplyAuditRetentionOptions, AuditRetentionResult } from "./audit-retention";

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
    await persistRiskFlagEvidence(input, createdAt);
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
  await persistRiskFlagEvidence(input, createdAt);
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
  const repo = await createRiskFlagRepository();
  try {
    const statuses = await repo.listEvidenceStatuses(options.providerSlug);
    const statusByRunId = new Map(statuses.map((status) => [status.runId, { riskFlagId: status.riskFlagId, status: status.status }]));
    return buildPublicAuditSummary(allRuns, options.providerSlug, statusByRunId);
  } finally {
    await repo.close();
  }
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

async function persistRiskFlagEvidence(input: SaveAuditRunInput, createdAt: string) {
  const severity = riskSeverity(input.status);
  if (!severity) return;
  const riskyAssertions = riskAssertions(input.assertions, severity);
  if (riskyAssertions.length === 0) return;
  const repo = await createRiskFlagRepository();
  try {
    for (const assertion of riskyAssertions) {
      const current = riskFlagInput(input, assertion, createdAt);
      const previous = await findPreviousConfirmingRiskRun(input, assertion.id);
      const linkedRunIds = new Set((await repo.listEvidenceStatuses(input.providerSlug)).map((status) => status.runId));
      if (!previous && !linkedRunIds.has(input.id)) continue;
      if (previous && !linkedRunIds.has(previous.input.id)) {
        await repo.upsertActive(riskFlagInput(previous.input, previous.assertion, previous.createdAt));
      }
      if (!linkedRunIds.has(input.id)) await repo.upsertActive(current);
    }
  } finally {
    await repo.close();
  }
}

function riskFlagInput(
  input: Pick<SaveAuditRunInput, "workspaceId" | "nodeId" | "providerSlug" | "id" | "targetModelId" | "suiteId" | "status" | "confidence" | "metrics" | "evidenceSummary">,
  assertion: ReturnType<typeof riskAssertions>[number],
  createdAt: string
) {
  return {
    workspaceId: input.workspaceId,
    nodeId: input.nodeId,
    providerSlug: input.providerSlug,
    assertionId: assertion.id,
    severity: assertion.severity,
    runId: input.id,
    targetModelId: input.targetModelId,
    suiteId: input.suiteId,
    redactedSummary: sanitizeRiskFlagSummary(input, assertion.publicSummary),
    observedAt: createdAt
  };
}

function sanitizeRiskFlagSummary(
  input: Pick<SaveAuditRunInput, "status" | "confidence" | "metrics" | "evidenceSummary">,
  assertion: Record<string, unknown>
) {
  return redactSecrets(stripUndefined({
    status: input.status,
    confidence: input.confidence,
    metrics: sanitizeRiskMetrics(input.metrics),
    assertion,
    evidenceSummary: sanitizeRiskEvidenceSummary(input.evidenceSummary)
  }));
}

function sanitizeRiskMetrics(value: unknown) {
  const record = asRecord(value);
  if (!record) return {};
  const metrics = pick(record, ["statusCode", "ttftMs", "totalLatencyMs", "tokenUsage", "billingVariance", "costEstimate"]);
  if (metrics.tokenUsage) metrics.tokenUsage = normalizePublicUsage(metrics.tokenUsage);
  if (metrics.billingVariance) metrics.billingVariance = pick(asRecord(metrics.billingVariance), ["reportedTokens", "expectedTokens", "varianceRatio"]);
  if (metrics.costEstimate) metrics.costEstimate = pick(asRecord(metrics.costEstimate), ["inputCostUsd", "outputCostUsd", "totalCostUsd", "currency"]);
  return stripUndefined(metrics) ?? {};
}

function sanitizeRiskEvidenceSummary(value: unknown) {
  const record = asRecord(value);
  if (!record) return {};
  const summary = pick(record, [
    "redaction",
    "requestBodyStored",
    "responseBodyStored",
    "targetHostHash",
    "completionHash",
    "usage",
    "billingVariance",
    "suiteId",
    "suiteVersion",
    "promptNonceHash",
    "numericNonceHash",
    "timestampBucket",
    "retestRecommendation",
    "responseExcerptPolicy",
    "fullResponseStored",
    "fullResponsePolicy",
    "finishReason",
    "errorCode",
    "errorType",
    "traceparent",
    "externalProbe",
    "probeRegion"
  ]);
  if (summary.usage) summary.usage = normalizePublicUsage(summary.usage);
  if (summary.billingVariance) summary.billingVariance = pick(asRecord(summary.billingVariance), ["reportedTokens", "expectedTokens", "varianceRatio"]);
  return stripUndefined(summary) ?? {};
}

function pick(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) return {};
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(record: T) {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

async function findPreviousConfirmingRiskRun(input: SaveAuditRunInput, assertionId: string) {
  const runs = await listAuditRuns({ limit: 5000 });
  for (const run of runs) {
    if (run.runId === input.id) continue;
    if (run.providerSlug !== input.providerSlug) continue;
    if (run.targetModelId !== input.targetModelId) continue;
    if (run.suiteId !== input.suiteId) continue;
    const severity = riskSeverity(run.status);
    const assertion = severity ? riskAssertions(run.assertions, severity).find((candidate) => candidate.id === assertionId) : undefined;
    if (!assertion) continue;
    return {
      assertion,
      createdAt: run.createdAt,
      input: {
        id: run.runId,
        workspaceId: run.workspaceId,
        nodeId: run.nodeId,
        providerSlug: run.providerSlug,
        suiteId: run.suiteId,
        targetModelId: run.targetModelId,
        status: run.status,
        confidence: run.confidence,
        metrics: run.metrics,
        evidenceSummary: run.evidenceSummary
      }
    };
  }
  return undefined;
}

function riskSeverity(status: string): RiskFlagSeverity | undefined {
  if (status === "error") return "error";
  if (status === "fail") return "fail";
  if (status === "warning") return "warning";
  return undefined;
}

function riskAssertions(assertions: unknown, fallbackSeverity: RiskFlagSeverity) {
  if (!Array.isArray(assertions)) return [{ id: "OVERALL_STATUS", severity: fallbackSeverity, publicSummary: { status: fallbackSeverity } }];
  const risky = assertions.flatMap((assertion) => {
    const record = assertion && typeof assertion === "object" && !Array.isArray(assertion) ? (assertion as Record<string, unknown>) : undefined;
    const status = typeof record?.status === "string" ? riskSeverity(record.status) : undefined;
    const id = typeof record?.id === "string" && record.id.trim() ? record.id : undefined;
    if (!record || !status || !id) return [];
    return [{ id, severity: status, publicSummary: publicAssertion(record) }];
  });
  return risky.length ? risky : [{ id: "OVERALL_STATUS", severity: fallbackSeverity, publicSummary: { status: fallbackSeverity } }];
}

function publicAssertion(record: Record<string, unknown>) {
  return {
    id: record.id,
    status: record.status,
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    message: typeof record.message === "string" ? record.message : undefined
  };
}
