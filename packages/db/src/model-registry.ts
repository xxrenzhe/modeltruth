import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type ModelRegistryStatus = "experimental" | "stable" | "deprecated";

export interface ModelRegistryRecord {
  id: string;
  provider: string;
  modelId: string;
  family: string;
  status: ModelRegistryStatus;
  supportsReasoningUsage: boolean;
  supportsStreaming: boolean;
  maxContextTokens?: number;
  baselineSuiteVersion: string;
  lastCalibratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertModelRegistryInput {
  provider: string;
  modelId: string;
  family: string;
  status?: ModelRegistryStatus;
  supportsReasoningUsage?: boolean;
  supportsStreaming?: boolean;
  maxContextTokens?: number;
  baselineSuiteVersion?: string;
}

export interface RecordModelCalibrationInput {
  provider: string;
  modelId: string;
  suiteId: string;
  suiteVersion: string;
  status: string;
  metrics: unknown;
  evidenceSummary: unknown;
  calibratedAt?: string;
}

export interface ModelCalibrationRecord extends RecordModelCalibrationInput {
  id: string;
  modelRegistryId: string;
  calibratedAt: string;
  createdAt: string;
}

export interface ModelRegistryRepository {
  upsert(input: UpsertModelRegistryInput): Promise<ModelRegistryRecord>;
  get(provider: string, modelId: string): Promise<ModelRegistryRecord | undefined>;
  list(): Promise<ModelRegistryRecord[]>;
  listDueForCalibration(cutoff: Date): Promise<ModelRegistryRecord[]>;
  recordCalibration(input: RecordModelCalibrationInput): Promise<ModelCalibrationRecord>;
  close(): Promise<void>;
}

export async function createModelRegistryRepository(): Promise<ModelRegistryRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresModelRegistryRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteModelRegistryRepository(new DatabaseSync(config.databasePath));
}

class SqliteModelRegistryRepository implements ModelRegistryRepository {
  constructor(private readonly db: { prepare(sql: string): any; close(): void }) {}

  async upsert(input: UpsertModelRegistryInput): Promise<ModelRegistryRecord> {
    const now = new Date().toISOString();
    const existing = await this.get(input.provider, input.modelId);
    const id = existing?.id ?? crypto.randomUUID();
    this.db
      .prepare(
        `insert into model_registry (
          id, provider, model_id, family, status, supports_reasoning_usage, supports_streaming,
          max_context_tokens, baseline_suite_version, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(provider, model_id) do update set
          family = excluded.family,
          status = excluded.status,
          supports_reasoning_usage = excluded.supports_reasoning_usage,
          supports_streaming = excluded.supports_streaming,
          max_context_tokens = excluded.max_context_tokens,
          baseline_suite_version = excluded.baseline_suite_version,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        input.provider,
        input.modelId,
        input.family,
        input.status ?? "experimental",
        input.supportsReasoningUsage ? 1 : 0,
        input.supportsStreaming ?? true ? 1 : 0,
        input.maxContextTokens ?? null,
        input.baselineSuiteVersion ?? "fingerprint-calibration@1.0.0",
        existing?.createdAt ?? now,
        now
      );
    return (await this.get(input.provider, input.modelId))!;
  }

  async get(provider: string, modelId: string): Promise<ModelRegistryRecord | undefined> {
    const row = this.db
      .prepare("select * from model_registry where provider = ? and model_id = ? limit 1")
      .get(provider, modelId) as ModelRegistryRow | undefined;
    return row ? mapModelRegistryRow(row) : undefined;
  }

  async list(): Promise<ModelRegistryRecord[]> {
    const rows = this.db.prepare("select * from model_registry order by provider asc, model_id asc").all() as ModelRegistryRow[];
    return rows.map(mapModelRegistryRow);
  }

  async listDueForCalibration(cutoff: Date): Promise<ModelRegistryRecord[]> {
    const rows = this.db
      .prepare(
        `select * from model_registry
         where status != 'deprecated'
           and (last_calibrated_at is null or last_calibrated_at <= ?)
         order by provider asc, model_id asc`
      )
      .all(cutoff.toISOString()) as ModelRegistryRow[];
    return rows.map(mapModelRegistryRow);
  }

  async recordCalibration(input: RecordModelCalibrationInput): Promise<ModelCalibrationRecord> {
    const model = await this.get(input.provider, input.modelId);
    if (!model) throw new Error(`Model registry entry not found: ${input.provider}/${input.modelId}`);
    const calibratedAt = input.calibratedAt ?? new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `insert into model_calibrations (
          id, model_registry_id, provider, model_id, suite_id, suite_version, status,
          metrics_json, evidence_summary_json, calibrated_at, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        model.id,
        input.provider,
        input.modelId,
        input.suiteId,
        input.suiteVersion,
        input.status,
        JSON.stringify(input.metrics),
        JSON.stringify(input.evidenceSummary),
        calibratedAt,
        calibratedAt
      );
    this.db
      .prepare("update model_registry set last_calibrated_at = ?, updated_at = ? where id = ?")
      .run(calibratedAt, calibratedAt, model.id);
    return { ...input, id, modelRegistryId: model.id, calibratedAt, createdAt: calibratedAt };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresModelRegistryRepository implements ModelRegistryRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async upsert(input: UpsertModelRegistryInput): Promise<ModelRegistryRecord> {
    const now = new Date().toISOString();
    const id = (await this.get(input.provider, input.modelId))?.id ?? crypto.randomUUID();
    await this.sql`
      insert into model_registry (
        id, provider, model_id, family, status, supports_reasoning_usage, supports_streaming,
        max_context_tokens, baseline_suite_version, created_at, updated_at
      ) values (
        ${id}, ${input.provider}, ${input.modelId}, ${input.family}, ${input.status ?? "experimental"},
        ${input.supportsReasoningUsage ?? false}, ${input.supportsStreaming ?? true}, ${input.maxContextTokens ?? null},
        ${input.baselineSuiteVersion ?? "fingerprint-calibration@1.0.0"}, ${now}, ${now}
      )
      on conflict(provider, model_id) do update set
        family = excluded.family,
        status = excluded.status,
        supports_reasoning_usage = excluded.supports_reasoning_usage,
        supports_streaming = excluded.supports_streaming,
        max_context_tokens = excluded.max_context_tokens,
        baseline_suite_version = excluded.baseline_suite_version,
        updated_at = excluded.updated_at
    `;
    return (await this.get(input.provider, input.modelId))!;
  }

  async get(provider: string, modelId: string): Promise<ModelRegistryRecord | undefined> {
    const rows = await this.sql<ModelRegistryRow[]>`
      select * from model_registry where provider = ${provider} and model_id = ${modelId} limit 1
    `;
    return rows[0] ? mapModelRegistryRow(rows[0]) : undefined;
  }

  async list(): Promise<ModelRegistryRecord[]> {
    const rows = await this.sql<ModelRegistryRow[]>`select * from model_registry order by provider asc, model_id asc`;
    return rows.map(mapModelRegistryRow);
  }

  async listDueForCalibration(cutoff: Date): Promise<ModelRegistryRecord[]> {
    const rows = await this.sql<ModelRegistryRow[]>`
      select * from model_registry
      where status != 'deprecated'
        and (last_calibrated_at is null or last_calibrated_at <= ${cutoff.toISOString()})
      order by provider asc, model_id asc
    `;
    return rows.map(mapModelRegistryRow);
  }

  async recordCalibration(input: RecordModelCalibrationInput): Promise<ModelCalibrationRecord> {
    const model = await this.get(input.provider, input.modelId);
    if (!model) throw new Error(`Model registry entry not found: ${input.provider}/${input.modelId}`);
    const calibratedAt = input.calibratedAt ?? new Date().toISOString();
    const id = crypto.randomUUID();
    await this.sql.begin(async (tx) => {
      await tx`
        insert into model_calibrations (
          id, model_registry_id, provider, model_id, suite_id, suite_version, status,
          metrics_json, evidence_summary_json, calibrated_at, created_at
        ) values (
          ${id}, ${model.id}, ${input.provider}, ${input.modelId}, ${input.suiteId}, ${input.suiteVersion},
          ${input.status}, ${tx.json(input.metrics as any)}, ${tx.json(input.evidenceSummary as any)}, ${calibratedAt}, ${calibratedAt}
        )
      `;
      await tx`update model_registry set last_calibrated_at = ${calibratedAt}, updated_at = ${calibratedAt} where id = ${model.id}`;
    });
    return { ...input, id, modelRegistryId: model.id, calibratedAt, createdAt: calibratedAt };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface ModelRegistryRow {
  id: string;
  provider: string;
  model_id: string;
  family: string;
  status: ModelRegistryStatus;
  supports_reasoning_usage: boolean | number;
  supports_streaming: boolean | number;
  max_context_tokens?: number;
  baseline_suite_version: string;
  last_calibrated_at?: string;
  created_at: string;
  updated_at: string;
}

function mapModelRegistryRow(row: ModelRegistryRow): ModelRegistryRecord {
  return {
    id: row.id,
    provider: row.provider,
    modelId: row.model_id,
    family: row.family,
    status: row.status,
    supportsReasoningUsage: Boolean(row.supports_reasoning_usage),
    supportsStreaming: Boolean(row.supports_streaming),
    maxContextTokens: row.max_context_tokens ?? undefined,
    baselineSuiteVersion: row.baseline_suite_version,
    lastCalibratedAt: row.last_calibrated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
