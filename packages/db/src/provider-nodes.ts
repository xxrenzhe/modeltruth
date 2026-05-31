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
  ttftThresholdMs: number;
  nextHeartbeatAt?: string;
  nextDeepAuditAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderNodeSecretRecord extends ProviderNodeRecord {
  encryptedApiKey?: string;
}

export interface ProviderNodeKeyRotationRecord {
  id: string;
  workspaceId: string;
  encryptedApiKey: string;
  apiKeySuffix?: string;
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
  ttftThresholdMs?: number;
}

export interface ProviderNodeRepository {
  create(input: CreateProviderNodeInput): Promise<ProviderNodeRecord>;
  list(workspaceId: string): Promise<ProviderNodeRecord[]>;
  getForAudit(id: string): Promise<ProviderNodeSecretRecord | undefined>;
  listKeysForRotation(limit?: number): Promise<ProviderNodeKeyRotationRecord[]>;
  updateEncryptedApiKey(id: string, encryptedApiKey: string): Promise<boolean>;
  listDueForSchedule(now: Date, limit?: number): Promise<ProviderNodeRecord[]>;
  markScheduled(id: string, kind: "heartbeat" | "deepAudit", nextRunAt: Date): Promise<void>;
  delete(workspaceId: string, id: string): Promise<boolean>;
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
          status, heartbeat_interval_seconds, deep_audit_interval_seconds, ttft_threshold_ms, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
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
        input.ttftThresholdMs ?? 3000,
        now,
        now
      );
    return (await this.list(input.workspaceId)).find((node) => node.id === id)!;
  }

  async list(workspaceId: string): Promise<ProviderNodeRecord[]> {
    const rows = this.db
      .prepare("select * from provider_nodes where workspace_id = ? and status != 'deleted' order by created_at desc")
      .all(workspaceId) as ProviderNodeRow[];
    return rows.map(mapProviderNodeRow);
  }

  async getForAudit(id: string): Promise<ProviderNodeSecretRecord | undefined> {
    const row = this.db
      .prepare("select * from provider_nodes where id = ? and status = 'active' and encrypted_api_key is not null limit 1")
      .get(id) as ProviderNodeRow | undefined;
    return row ? mapProviderNodeSecretRow(row) : undefined;
  }

  async listKeysForRotation(limit = 1000): Promise<ProviderNodeKeyRotationRecord[]> {
    const rows = this.db
      .prepare(
        `select id, workspace_id, encrypted_api_key, api_key_suffix
         from provider_nodes
         where status = 'active' and encrypted_api_key is not null
         order by created_at asc
         limit ?`
      )
      .all(limit) as Array<{
      id: string;
      workspace_id: string;
      encrypted_api_key: string;
      api_key_suffix?: string;
    }>;
    return rows.map(mapProviderNodeKeyRotationRow);
  }

  async updateEncryptedApiKey(id: string, encryptedApiKey: string): Promise<boolean> {
    const result = this.db
      .prepare("update provider_nodes set encrypted_api_key = ?, updated_at = ? where id = ? and status = 'active'")
      .run(encryptedApiKey, new Date().toISOString(), id) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
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

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `update provider_nodes
         set status = 'deleted',
             encrypted_api_key = null,
             api_key_suffix = null,
             next_heartbeat_at = null,
             next_deep_audit_at = null,
             deleted_at = ?,
             updated_at = ?
         where id = ? and workspace_id = ? and status != 'deleted'`
      )
      .run(now, now, id, workspaceId) as { changes?: number };
    return Number(result.changes ?? 0) > 0;
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
        status, heartbeat_interval_seconds, deep_audit_interval_seconds, ttft_threshold_ms, created_at, updated_at
      ) values (
        ${id}, ${input.workspaceId}, ${input.name}, ${input.baseUrl}, ${input.baseUrlHostHash}, ${input.modelId},
        ${input.encryptedApiKey}, ${input.apiKeySuffix}, 'active', ${input.heartbeatIntervalSeconds ?? 300},
        ${input.deepAuditIntervalSeconds ?? 43200}, ${input.ttftThresholdMs ?? 3000}, ${now}, ${now}
      )
    `;
    return (await this.list(input.workspaceId)).find((node) => node.id === id)!;
  }

  async list(workspaceId: string): Promise<ProviderNodeRecord[]> {
    const rows = await this.sql<ProviderNodeRow[]>`
      select * from provider_nodes where workspace_id = ${workspaceId} and status != 'deleted' order by created_at desc
    `;
    return rows.map(mapProviderNodeRow);
  }

  async getForAudit(id: string): Promise<ProviderNodeSecretRecord | undefined> {
    const rows = await this.sql<ProviderNodeRow[]>`
      select * from provider_nodes
      where id = ${id} and status = 'active' and encrypted_api_key is not null
      limit 1
    `;
    return rows[0] ? mapProviderNodeSecretRow(rows[0]) : undefined;
  }

  async listKeysForRotation(limit = 1000): Promise<ProviderNodeKeyRotationRecord[]> {
    const rows = await this.sql<
      Array<{ id: string; workspace_id: string; encrypted_api_key: string; api_key_suffix?: string }>
    >`
      select id, workspace_id, encrypted_api_key, api_key_suffix
      from provider_nodes
      where status = 'active' and encrypted_api_key is not null
      order by created_at asc
      limit ${limit}
    `;
    return rows.map(mapProviderNodeKeyRotationRow);
  }

  async updateEncryptedApiKey(id: string, encryptedApiKey: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      update provider_nodes
      set encrypted_api_key = ${encryptedApiKey}, updated_at = ${new Date().toISOString()}
      where id = ${id} and status = 'active'
      returning id
    `;
    return rows.length > 0;
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

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const rows = await this.sql<{ id: string }[]>`
      update provider_nodes
      set status = 'deleted',
          encrypted_api_key = null,
          api_key_suffix = null,
          next_heartbeat_at = null,
          next_deep_audit_at = null,
          deleted_at = ${now},
          updated_at = ${now}
      where id = ${id} and workspace_id = ${workspaceId} and status != 'deleted'
      returning id
    `;
    return rows.length > 0;
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
  ttft_threshold_ms: number;
  next_heartbeat_at?: string;
  next_deep_audit_at?: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

function mapProviderNodeSecretRow(row: ProviderNodeRow): ProviderNodeSecretRecord {
  return {
    ...mapProviderNodeRow(row),
    encryptedApiKey: row.encrypted_api_key
  };
}

function mapProviderNodeKeyRotationRow(row: {
  id: string;
  workspace_id: string;
  encrypted_api_key: string;
  api_key_suffix?: string;
}): ProviderNodeKeyRotationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    encryptedApiKey: row.encrypted_api_key,
    apiKeySuffix: row.api_key_suffix
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
    ttftThresholdMs: row.ttft_threshold_ms,
    nextHeartbeatAt: row.next_heartbeat_at,
    nextDeepAuditAt: row.next_deep_audit_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
