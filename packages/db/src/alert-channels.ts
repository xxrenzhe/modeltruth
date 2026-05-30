import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type AlertChannelType = "webhook" | "slack" | "discord";

export interface AlertChannelRecord {
  id: string;
  workspaceId: string;
  type: AlertChannelType;
  enabled: boolean;
  targetSuffix?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertChannelSecretRecord extends AlertChannelRecord {
  encryptedTarget: string;
}

export interface CreateAlertChannelInput {
  workspaceId: string;
  type: AlertChannelType;
  encryptedTarget: string;
  targetSuffix?: string;
}

export interface AlertChannelRepository {
  create(input: CreateAlertChannelInput): Promise<AlertChannelRecord>;
  list(workspaceId: string): Promise<AlertChannelRecord[]>;
  listEnabledSecrets(workspaceId: string): Promise<AlertChannelSecretRecord[]>;
  close(): Promise<void>;
}

export async function createAlertChannelRepository(): Promise<AlertChannelRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresAlertChannelRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteAlertChannelRepository(new DatabaseSync(config.databasePath));
}

class SqliteAlertChannelRepository implements AlertChannelRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async create(input: CreateAlertChannelInput): Promise<AlertChannelRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `insert into alert_channels (id, workspace_id, type, encrypted_target, enabled, created_at, updated_at)
         values (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, input.workspaceId, input.type, input.encryptedTarget, now, now);
    return (await this.list(input.workspaceId)).find((channel) => channel.id === id)!;
  }

  async list(workspaceId: string): Promise<AlertChannelRecord[]> {
    const rows = this.db
      .prepare("select * from alert_channels where workspace_id = ? order by created_at desc")
      .all(workspaceId) as AlertChannelRow[];
    return rows.map(mapAlertChannelRow);
  }

  async listEnabledSecrets(workspaceId: string): Promise<AlertChannelSecretRecord[]> {
    const rows = this.db
      .prepare("select * from alert_channels where workspace_id = ? and enabled = 1 order by created_at asc")
      .all(workspaceId) as AlertChannelRow[];
    return rows.map(mapAlertChannelSecretRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresAlertChannelRepository implements AlertChannelRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async create(input: CreateAlertChannelInput): Promise<AlertChannelRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await this.sql`
      insert into alert_channels (id, workspace_id, type, encrypted_target, enabled, created_at, updated_at)
      values (${id}, ${input.workspaceId}, ${input.type}, ${input.encryptedTarget}, 1, ${now}, ${now})
    `;
    return (await this.list(input.workspaceId)).find((channel) => channel.id === id)!;
  }

  async list(workspaceId: string): Promise<AlertChannelRecord[]> {
    const rows = await this.sql<AlertChannelRow[]>`
      select * from alert_channels where workspace_id = ${workspaceId} order by created_at desc
    `;
    return rows.map(mapAlertChannelRow);
  }

  async listEnabledSecrets(workspaceId: string): Promise<AlertChannelSecretRecord[]> {
    const rows = await this.sql<AlertChannelRow[]>`
      select * from alert_channels where workspace_id = ${workspaceId} and enabled = 1 order by created_at asc
    `;
    return rows.map(mapAlertChannelSecretRow);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface AlertChannelRow {
  id: string;
  workspace_id: string;
  type: AlertChannelType;
  encrypted_target: string;
  enabled: number | boolean;
  created_at: string;
  updated_at: string;
}

function mapAlertChannelRow(row: AlertChannelRow): AlertChannelRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    enabled: row.enabled === true || row.enabled === 1,
    targetSuffix: targetSuffix(row.encrypted_target),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAlertChannelSecretRow(row: AlertChannelRow): AlertChannelSecretRecord {
  return {
    ...mapAlertChannelRow(row),
    encryptedTarget: row.encrypted_target
  };
}

function targetSuffix(value: string) {
  return value.length <= 8 ? value : value.slice(-8);
}
