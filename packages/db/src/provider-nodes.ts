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
  createdAt: string;
  updatedAt: string;
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
    await this.ensureWorkspace(input.workspaceId, now);
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

  async close(): Promise<void> {
    this.db.close();
  }

  private async ensureWorkspace(workspaceId: string, now: string) {
    const userId = "system_user";
    this.db
      .prepare("insert or ignore into users (id, email, name, created_at, updated_at) values (?, ?, ?, ?, ?)")
      .run(userId, "system@modeltruth.local", "System User", now, now);
    this.db
      .prepare("insert or ignore into workspaces (id, owner_id, name, tier, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
      .run(workspaceId, userId, "Default Workspace", "free", now, now);
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
    await this.sql.begin(async (tx) => {
      await tx`
        insert into users (id, email, name, created_at, updated_at)
        values ('system_user', 'system@modeltruth.local', 'System User', ${now}, ${now})
        on conflict (id) do nothing
      `;
      await tx`
        insert into workspaces (id, owner_id, name, tier, created_at, updated_at)
        values (${input.workspaceId}, 'system_user', 'Default Workspace', 'free', ${now}, ${now})
        on conflict (id) do nothing
      `;
      await tx`
        insert into provider_nodes (
          id, workspace_id, name, base_url, base_url_host_hash, model_id, encrypted_api_key, api_key_suffix,
          status, heartbeat_interval_seconds, deep_audit_interval_seconds, created_at, updated_at
        ) values (
          ${id}, ${input.workspaceId}, ${input.name}, ${input.baseUrl}, ${input.baseUrlHostHash}, ${input.modelId},
          ${input.encryptedApiKey}, ${input.apiKeySuffix}, 'active', ${input.heartbeatIntervalSeconds ?? 300},
          ${input.deepAuditIntervalSeconds ?? 43200}, ${now}, ${now}
        )
      `;
    });
    return (await this.list(input.workspaceId)).find((node) => node.id === id)!;
  }

  async list(workspaceId: string): Promise<ProviderNodeRecord[]> {
    const rows = await this.sql<ProviderNodeRow[]>`
      select * from provider_nodes where workspace_id = ${workspaceId} order by created_at desc
    `;
    return rows.map(mapProviderNodeRow);
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
  api_key_suffix?: string;
  status: string;
  heartbeat_interval_seconds: number;
  deep_audit_interval_seconds: number;
  created_at: string;
  updated_at: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
