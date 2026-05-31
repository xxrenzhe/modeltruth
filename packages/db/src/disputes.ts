import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type ProviderDisputeStatus = "under_review" | "resolved" | "provider_response_attached";
export type ProviderDisputeRequestType = "correction" | "takedown" | "provider_response";

export interface CreateProviderDisputeInput {
  providerSlug: string;
  runId?: string;
  requestType?: ProviderDisputeRequestType;
  contactEmail: string;
  statement: string;
  evidenceUrl?: string;
}

export interface ProviderDisputeRecord extends CreateProviderDisputeInput {
  id: string;
  status: ProviderDisputeStatus;
  reviewDueAt?: string;
  reviewStartedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderDisputeRepository {
  create(input: CreateProviderDisputeInput): Promise<ProviderDisputeRecord>;
  listByProvider(providerSlug: string): Promise<ProviderDisputeRecord[]>;
  markProviderResponseAttached(id: string): Promise<ProviderDisputeRecord | undefined>;
  close(): Promise<void>;
}

export async function createProviderDisputeRepository(): Promise<ProviderDisputeRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresProviderDisputeRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteProviderDisputeRepository(new DatabaseSync(config.databasePath));
}

class SqliteProviderDisputeRepository implements ProviderDisputeRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async create(input: CreateProviderDisputeInput): Promise<ProviderDisputeRecord> {
    const now = new Date().toISOString();
    const reviewDueAt = reviewDueAtFrom(now);
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `insert into provider_disputes (
          id, provider_slug, run_id, request_type, contact_email, statement, evidence_url, status,
          review_due_at, review_started_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'under_review', ?, ?, ?, ?)`
      )
      .run(
        id,
        input.providerSlug,
        input.runId ?? null,
        input.requestType ?? "correction",
        input.contactEmail,
        input.statement,
        input.evidenceUrl ?? null,
        reviewDueAt,
        now,
        now,
        now
      );
    return (await this.listByProvider(input.providerSlug)).find((dispute) => dispute.id === id)!;
  }

  async listByProvider(providerSlug: string): Promise<ProviderDisputeRecord[]> {
    const rows = this.db
      .prepare("select * from provider_disputes where provider_slug = ? order by created_at desc")
      .all(providerSlug) as ProviderDisputeRow[];
    return rows.map(mapRow);
  }

  async markProviderResponseAttached(id: string): Promise<ProviderDisputeRecord | undefined> {
    const now = new Date().toISOString();
    this.db
      .prepare("update provider_disputes set status = 'provider_response_attached', updated_at = ? where id = ?")
      .run(now, id);
    const row = this.db.prepare("select * from provider_disputes where id = ? limit 1").get(id) as ProviderDisputeRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresProviderDisputeRepository implements ProviderDisputeRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async create(input: CreateProviderDisputeInput): Promise<ProviderDisputeRecord> {
    const now = new Date().toISOString();
    const reviewDueAt = reviewDueAtFrom(now);
    const id = crypto.randomUUID();
    await this.sql`
      insert into provider_disputes (
        id, provider_slug, run_id, request_type, contact_email, statement, evidence_url, status,
        review_due_at, review_started_at, created_at, updated_at
      ) values (
        ${id}, ${input.providerSlug}, ${input.runId ?? null}, ${input.requestType ?? "correction"},
        ${input.contactEmail}, ${input.statement},
        ${input.evidenceUrl ?? null}, 'under_review', ${reviewDueAt}, ${now}, ${now}, ${now}
      )
    `;
    return (await this.listByProvider(input.providerSlug)).find((dispute) => dispute.id === id)!;
  }

  async listByProvider(providerSlug: string): Promise<ProviderDisputeRecord[]> {
    const rows = await this.sql<ProviderDisputeRow[]>`
      select * from provider_disputes where provider_slug = ${providerSlug} order by created_at desc
    `;
    return rows.map(mapRow);
  }

  async markProviderResponseAttached(id: string): Promise<ProviderDisputeRecord | undefined> {
    const rows = await this.sql<ProviderDisputeRow[]>`
      update provider_disputes
      set status = 'provider_response_attached', updated_at = ${new Date().toISOString()}
      where id = ${id}
      returning *
    `;
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface ProviderDisputeRow {
  id: string;
  provider_slug: string;
  run_id?: string;
  request_type?: ProviderDisputeRequestType;
  contact_email: string;
  statement: string;
  evidence_url?: string;
  status: ProviderDisputeStatus;
  review_due_at?: string;
  review_started_at?: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ProviderDisputeRow): ProviderDisputeRecord {
  return {
    id: row.id,
    providerSlug: row.provider_slug,
    runId: row.run_id,
    requestType: row.request_type ?? "correction",
    contactEmail: row.contact_email,
    statement: row.statement,
    evidenceUrl: row.evidence_url,
    status: row.status,
    reviewDueAt: row.review_due_at,
    reviewStartedAt: row.review_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function reviewDueAtFrom(nowIso: string) {
  return new Date(new Date(nowIso).getTime() + 48 * 60 * 60 * 1000).toISOString();
}
