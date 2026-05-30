import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface ProviderNodeRecord {
  id: string;
  workspaceId: string;
  name: string;
  baseUrl: string;
  baseUrlHostHash: string;
  modelId: string;
  apiKeySuffix?: string;
  status: string;
  heartbeatIntervalSeconds: number;
  deepAuditIntervalSeconds: number;
  nextHeartbeatAt?: string;
  nextDeepAuditAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderNodeSecretRecord extends ProviderNodeRecord {
  encryptedApiKey?: string;
}

export interface CreateProviderNodeInput {
  workspaceId: string;
  name: string;
  baseUrl: string;
  baseUrlHostHash: string;
  modelId: string;
  encryptedApiKey: string;
  apiKeySuffix: string;
  heartbeatIntervalSeconds?: number;
  deepAuditIntervalSeconds?: number;
}

export interface ProviderNodeRepository {
  create(input: CreateProviderNodeInput): Promise<ProviderNodeRecord>;
  list(workspaceId: string): Promise<ProviderNodeRecord[]>;
  getForAudit(id: string): Promise<ProviderNodeSecretRecord | undefined>;
  listDueForSchedule(now: Date, limit?: number): Promise<ProviderNodeRecord[]>;
  markScheduled(id: string, kind: "heartbeat" | "deepAudit", nextRunAt: Date): Promise<void>;
  close(): Promise<void>;
}

export async function createProviderNodeRepository(): Promise<ProviderNodeRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresProviderNodeRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteProviderNodeRepository(new DatabaseSync(config.databasePath));
}

class SqliteProviderNodeRepository implements ProviderNodeRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async create(input: CreateProviderNodeInput): Promise<ProviderNodeRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `insert into provider_nodes (
          id, workspace_id, name, base_url, base_url_host_hash, model_id, encrypted_api_key, api_key_suffix,
          status, heartbeat_interval_seconds, deep_audit_interval_seconds, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
      .run(
        id,
        input.workspaceId,
        input.name,
        input.baseUrl,
        input.baseUrlHostHash,
        input.modelId,
        input.encryptedApiKey,
        input.apiKeySuffix,
        input.heartbeatIntervalSeconds ?? 300,
        input.deepAuditIntervalSeconds ?? 43200,
        now,
        now
      );
    return (await this.list(input.workspaceId)).find((node) => node.id === id)!;
  }

  async list(workspaceId: string): Promise<ProviderNodeRecord[]> {
    const rows = this.db
      .prepare("select * from provider_nodes where workspace_id = ? order by created_at desc")
      .all(workspaceId) as ProviderNodeRow[];
    return rows.map(mapProviderNodeRow);
  }

  async getForAudit(id: string): Promise<ProviderNodeSecretRecord | undefined> {
    const row = this.db.prepare("select * from provider_nodes where id = ? limit 1").get(id) as ProviderNodeRow | undefined;
    return row ? mapProviderNodeSecretRow(row) : undefined;
  }

  async listDueForSchedule(now: Date, limit = 50): Promise<ProviderNodeRecord[]> {
    const rows = this.db
      .prepare(
        `select * from provider_nodes
         where status = 'active'
           and (
             next_heartbeat_at is null or next_heartbeat_at <= ?
             or next_deep_audit_at is null or next_deep_audit_at <= ?
           )
         order by created_at asc
         limit ?`
      )
      .all(now.toISOString(), now.toISOString(), limit) as ProviderNodeRow[];
    return rows.map(mapProviderNodeRow);
  }

  async markScheduled(id: string, kind: "heartbeat" | "deepAudit", nextRunAt: Date): Promise<void> {
    const column = kind === "heartbeat" ? "next_heartbeat_at" : "next_deep_audit_at";
    this.db.prepare(`update provider_nodes set ${column} = ?, updated_at = ? where id = ?`).run(
      nextRunAt.toISOString(),
      new Date().toISOString(),
      id
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresProviderNodeRepository implements ProviderNodeRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async create(input: CreateProviderNodeInput): Promise<ProviderNodeRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await this.sql`
      insert into provider_nodes (
        id, workspace_id, name, base_url, base_url_host_hash, model_id, encrypted_api_key, api_key_suffix,
        status, heartbeat_interval_seconds, deep_audit_interval_seconds, created_at, updated_at
      ) values (
        ${id}, ${input.workspaceId}, ${input.name}, ${input.baseUrl}, ${input.baseUrlHostHash}, ${input.modelId},
        ${input.encryptedApiKey}, ${input.apiKeySuffix}, 'active', ${input.heartbeatIntervalSeconds ?? 300},
        ${input.deepAuditIntervalSeconds ?? 43200}, ${now}, ${now}
      )
    `;
    return (await this.list(input.workspaceId)).find((node) => node.id === id)!;
  }

  async list(workspaceId: string): Promise<ProviderNodeRecord[]> {
    const rows = await this.sql<ProviderNodeRow[]>`
      select * from provider_nodes where workspace_id = ${workspaceId} order by created_at desc
    `;
    return rows.map(mapProviderNodeRow);
  }

  async getForAudit(id: string): Promise<ProviderNodeSecretRecord | undefined> {
    const rows = await this.sql<ProviderNodeRow[]>`select * from provider_nodes where id = ${id} limit 1`;
    return rows[0] ? mapProviderNodeSecretRow(rows[0]) : undefined;
  }

  async listDueForSchedule(now: Date, limit = 50): Promise<ProviderNodeRecord[]> {
    const rows = await this.sql<ProviderNodeRow[]>`
      select * from provider_nodes
      where status = 'active'
        and (
          next_heartbeat_at is null or next_heartbeat_at <= ${now.toISOString()}
          or next_deep_audit_at is null or next_deep_audit_at <= ${now.toISOString()}
        )
      order by created_at asc
      limit ${limit}
    `;
    return rows.map(mapProviderNodeRow);
  }

  async markScheduled(id: string, kind: "heartbeat" | "deepAudit", nextRunAt: Date): Promise<void> {
    if (kind === "heartbeat") {
      await this.sql`update provider_nodes set next_heartbeat_at = ${nextRunAt.toISOString()}, updated_at = ${new Date().toISOString()} where id = ${id}`;
      return;
    }
    await this.sql`update provider_nodes set next_deep_audit_at = ${nextRunAt.toISOString()}, updated_at = ${new Date().toISOString()} where id = ${id}`;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface ProviderNodeRow {
  id: string;
  workspace_id: string;
  name: string;
  base_url: string;
  base_url_host_hash: string;
  model_id: string;
  encrypted_api_key?: string;
  api_key_suffix?: string;
  status: string;
  heartbeat_interval_seconds: number;
  deep_audit_interval_seconds: number;
  next_heartbeat_at?: string;
  next_deep_audit_at?: string;
  created_at: string;
  updated_at: string;
}

function mapProviderNodeSecretRow(row: ProviderNodeRow): ProviderNodeSecretRecord {
  return {
    ...mapProviderNodeRow(row),
    encryptedApiKey: row.encrypted_api_key
  };
}

function mapProviderNodeRow(row: ProviderNodeRow): ProviderNodeRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    baseUrl: row.base_url,
    baseUrlHostHash: row.base_url_host_hash,
    modelId: row.model_id,
    apiKeySuffix: row.api_key_suffix,
    status: row.status,
    heartbeatIntervalSeconds: row.heartbeat_interval_seconds,
    deepAuditIntervalSeconds: row.deep_audit_interval_seconds,
    nextHeartbeatAt: row.next_heartbeat_at,
    nextDeepAuditAt: row.next_deep_audit_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
