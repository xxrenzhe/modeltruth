import { createHash } from "node:crypto";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type GtmTrafficSurface = "site" | "public_dashboard" | "provider_board" | "playground" | "pricing" | "cli";
export type GtmExternalMetricSource = "github_stars" | "package_downloads" | "cli_installs";

export interface RecordGtmVisitInput {
  surface: GtmTrafficSurface;
  visitorSeed: string;
  occurredAt?: Date;
}

export interface UpsertGtmExternalMetricInput {
  source: GtmExternalMetricSource;
  metricValue: number;
  capturedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface GtmAnalyticsRepository {
  recordVisit(input: RecordGtmVisitInput): Promise<void>;
  upsertExternalMetric(input: UpsertGtmExternalMetricInput): Promise<void>;
  close(): Promise<void>;
}

export async function createGtmAnalyticsRepository(): Promise<GtmAnalyticsRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresGtmAnalyticsRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteGtmAnalyticsRepository(new DatabaseSync(config.databasePath));
}

class SqliteGtmAnalyticsRepository implements GtmAnalyticsRepository {
  constructor(private readonly db: { prepare(sql: string): any; close(): void }) {}

  async recordVisit(input: RecordGtmVisitInput): Promise<void> {
    const record = normalizeVisit(input);
    this.db
      .prepare(
        `insert into gtm_daily_visitors (day, surface, visitor_hash, first_seen_at, last_seen_at, visit_count)
         values (?, ?, ?, ?, ?, 1)
         on conflict(day, surface, visitor_hash) do update set
           last_seen_at = excluded.last_seen_at,
           visit_count = gtm_daily_visitors.visit_count + 1`
      )
      .run(record.day, record.surface, record.visitorHash, record.at, record.at);
  }

  async upsertExternalMetric(input: UpsertGtmExternalMetricInput): Promise<void> {
    const record = normalizeExternalMetric(input);
    this.db
      .prepare(
        `insert into gtm_external_metric_snapshots (source, metric_value, captured_at, metadata_json)
         values (?, ?, ?, ?)
         on conflict(source) do update set
           metric_value = excluded.metric_value,
           captured_at = excluded.captured_at,
           metadata_json = excluded.metadata_json`
      )
      .run(record.source, record.metricValue, record.capturedAt, JSON.stringify(record.metadata));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresGtmAnalyticsRepository implements GtmAnalyticsRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async recordVisit(input: RecordGtmVisitInput): Promise<void> {
    const record = normalizeVisit(input);
    await this.sql`
      insert into gtm_daily_visitors (day, surface, visitor_hash, first_seen_at, last_seen_at, visit_count)
      values (${record.day}, ${record.surface}, ${record.visitorHash}, ${record.at}, ${record.at}, 1)
      on conflict (day, surface, visitor_hash) do update set
        last_seen_at = excluded.last_seen_at,
        visit_count = gtm_daily_visitors.visit_count + 1
    `;
  }

  async upsertExternalMetric(input: UpsertGtmExternalMetricInput): Promise<void> {
    const record = normalizeExternalMetric(input);
    await this.sql`
      insert into gtm_external_metric_snapshots (source, metric_value, captured_at, metadata_json)
      values (${record.source}, ${record.metricValue}, ${record.capturedAt}, ${this.sql.json(record.metadata)})
      on conflict (source) do update set
        metric_value = excluded.metric_value,
        captured_at = excluded.captured_at,
        metadata_json = excluded.metadata_json
    `;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

function normalizeVisit(input: RecordGtmVisitInput) {
  if (!isTrafficSurface(input.surface)) throw new Error("invalid analytics surface");
  const seed = input.visitorSeed.trim();
  if (seed.length < 3) throw new Error("visitor seed is required");
  const at = (input.occurredAt ?? new Date()).toISOString();
  return {
    surface: input.surface,
    visitorHash: createHash("sha256").update(seed).digest("hex"),
    day: at.slice(0, 10),
    at
  };
}

function normalizeExternalMetric(input: UpsertGtmExternalMetricInput) {
  if (!isExternalMetricSource(input.source)) throw new Error("invalid external metric source");
  if (!Number.isInteger(input.metricValue) || input.metricValue < 0) throw new Error("metricValue must be a non-negative integer");
  return {
    source: input.source,
    metricValue: input.metricValue,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    metadata: sanitizeMetadata(input.metadata)
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata ?? {}).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_.:-]{1,40}$/.test(key)) continue;
    if (isSensitiveMetadataKey(key)) continue;
    if (typeof value === "string") sanitized[key] = value.slice(0, 120);
    else if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
    else if (typeof value === "boolean") sanitized[key] = value;
  }
  return sanitized;
}

function isSensitiveMetadataKey(key: string) {
  return ["authorization", "cookie", "password", "secret", "token", "api_key", "apikey"].includes(key.toLowerCase());
}

function isTrafficSurface(value: string): value is GtmTrafficSurface {
  return ["site", "public_dashboard", "provider_board", "playground", "pricing", "cli"].includes(value);
}

function isExternalMetricSource(value: string): value is GtmExternalMetricSource {
  return ["github_stars", "package_downloads", "cli_installs"].includes(value);
}
