import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface WorkspacePrivacySettings {
  workspaceId: string;
  saveFullResponses: boolean;
  updatedAt: string;
}

export interface WorkspacePrivacyRepository {
  get(workspaceId: string): Promise<WorkspacePrivacySettings>;
  update(workspaceId: string, input: { saveFullResponses: boolean }): Promise<WorkspacePrivacySettings>;
  close(): Promise<void>;
}

export async function createWorkspacePrivacyRepository(): Promise<WorkspacePrivacyRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresWorkspacePrivacyRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteWorkspacePrivacyRepository(new DatabaseSync(config.databasePath));
}

class SqliteWorkspacePrivacyRepository implements WorkspacePrivacyRepository {
  constructor(private readonly db: { prepare(sql: string): any; close(): void }) {}

  async get(workspaceId: string): Promise<WorkspacePrivacySettings> {
    const row = this.db
      .prepare("select * from workspace_privacy_settings where workspace_id = ? limit 1")
      .get(workspaceId) as WorkspacePrivacyRow | undefined;
    return row ? mapRow(row) : defaultSettings(workspaceId);
  }

  async update(workspaceId: string, input: { saveFullResponses: boolean }): Promise<WorkspacePrivacySettings> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into workspace_privacy_settings (workspace_id, save_full_responses, updated_at)
         values (?, ?, ?)
         on conflict(workspace_id) do update set
           save_full_responses = excluded.save_full_responses,
           updated_at = excluded.updated_at`
      )
      .run(workspaceId, input.saveFullResponses ? 1 : 0, now);
    return { workspaceId, saveFullResponses: input.saveFullResponses, updatedAt: now };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresWorkspacePrivacyRepository implements WorkspacePrivacyRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async get(workspaceId: string): Promise<WorkspacePrivacySettings> {
    const rows = await this.sql<WorkspacePrivacyRow[]>`
      select * from workspace_privacy_settings where workspace_id = ${workspaceId} limit 1
    `;
    return rows[0] ? mapRow(rows[0]) : defaultSettings(workspaceId);
  }

  async update(workspaceId: string, input: { saveFullResponses: boolean }): Promise<WorkspacePrivacySettings> {
    const now = new Date().toISOString();
    const rows = await this.sql<WorkspacePrivacyRow[]>`
      insert into workspace_privacy_settings (workspace_id, save_full_responses, updated_at)
      values (${workspaceId}, ${input.saveFullResponses}, ${now})
      on conflict (workspace_id) do update set
        save_full_responses = excluded.save_full_responses,
        updated_at = excluded.updated_at
      returning *
    `;
    return mapRow(rows[0]);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface WorkspacePrivacyRow {
  workspace_id: string;
  save_full_responses: boolean | number;
  updated_at: string | Date;
}

function defaultSettings(workspaceId: string): WorkspacePrivacySettings {
  return { workspaceId, saveFullResponses: false, updatedAt: "" };
}

function mapRow(row: WorkspacePrivacyRow): WorkspacePrivacySettings {
  return {
    workspaceId: row.workspace_id,
    saveFullResponses: row.save_full_responses === true || row.save_full_responses === 1,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}
