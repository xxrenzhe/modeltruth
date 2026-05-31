import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type WorkspaceMemberRole = "owner" | "member";
export type WorkspaceMemberStatus = "invited" | "active";

export interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId?: string;
  email: string;
  role: WorkspaceMemberRole;
  status: WorkspaceMemberStatus;
  invitedByUserId?: string;
  invitedAt: string;
  joinedAt?: string;
  updatedAt: string;
}

export interface WorkspaceMemberRepository {
  invite(input: { workspaceId: string; invitedByUserId: string; email: string; role?: WorkspaceMemberRole }): Promise<WorkspaceMemberRecord>;
  list(workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  getRole(workspaceId: string, userId: string): Promise<WorkspaceMemberRole | undefined>;
  close(): Promise<void>;
}

export async function createWorkspaceMemberRepository(): Promise<WorkspaceMemberRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresWorkspaceMemberRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteWorkspaceMemberRepository(new DatabaseSync(config.databasePath));
}

class SqliteWorkspaceMemberRepository implements WorkspaceMemberRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async invite(input: { workspaceId: string; invitedByUserId: string; email: string; role?: WorkspaceMemberRole }) {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    this.db
      .prepare(
        `insert into workspace_members (id, workspace_id, email, role, status, invited_by_user_id, invited_at, updated_at)
         values (?, ?, ?, ?, 'invited', ?, ?, ?)
         on conflict(workspace_id, email) do update set
           role = excluded.role,
           status = case when workspace_members.status = 'active' then 'active' else 'invited' end,
           invited_by_user_id = excluded.invited_by_user_id,
           invited_at = excluded.invited_at,
           updated_at = excluded.updated_at`
      )
      .run(randomUUID(), input.workspaceId, email, input.role ?? "member", input.invitedByUserId, now, now);
    return (await this.list(input.workspaceId)).find((member) => member.email === email)!;
  }

  async list(workspaceId: string) {
    const rows = this.db
      .prepare("select * from workspace_members where workspace_id = ? order by role desc, invited_at asc")
      .all(workspaceId) as WorkspaceMemberRow[];
    return rows.map(mapRow);
  }

  async getRole(workspaceId: string, userId: string) {
    const row = this.db
      .prepare("select role from workspace_members where workspace_id = ? and user_id = ? and status = 'active' limit 1")
      .get(workspaceId, userId) as { role: WorkspaceMemberRole } | undefined;
    return row?.role;
  }

  async close() {
    this.db.close();
  }
}

class PostgresWorkspaceMemberRepository implements WorkspaceMemberRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async invite(input: { workspaceId: string; invitedByUserId: string; email: string; role?: WorkspaceMemberRole }) {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    await this.sql`
      insert into workspace_members (id, workspace_id, email, role, status, invited_by_user_id, invited_at, updated_at)
      values (${randomUUID()}, ${input.workspaceId}, ${email}, ${input.role ?? "member"}, 'invited', ${input.invitedByUserId}, ${now}, ${now})
      on conflict (workspace_id, email) do update set
        role = excluded.role,
        status = case when workspace_members.status = 'active' then 'active' else 'invited' end,
        invited_by_user_id = excluded.invited_by_user_id,
        invited_at = excluded.invited_at,
        updated_at = excluded.updated_at
    `;
    return (await this.list(input.workspaceId)).find((member) => member.email === email)!;
  }

  async list(workspaceId: string) {
    const rows = await this.sql<WorkspaceMemberRow[]>`
      select * from workspace_members where workspace_id = ${workspaceId} order by role desc, invited_at asc
    `;
    return rows.map(mapRow);
  }

  async getRole(workspaceId: string, userId: string) {
    const rows = await this.sql<{ role: WorkspaceMemberRole }[]>`
      select role from workspace_members
      where workspace_id = ${workspaceId} and user_id = ${userId} and status = 'active'
      limit 1
    `;
    return rows[0]?.role;
  }

  async close() {
    await this.sql.end();
  }
}

interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id?: string;
  email: string;
  role: WorkspaceMemberRole;
  status: WorkspaceMemberStatus;
  invited_by_user_id?: string;
  invited_at: string;
  joined_at?: string;
  updated_at: string;
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error("Invalid email");
  return normalized;
}

function mapRow(row: WorkspaceMemberRow): WorkspaceMemberRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invited_by_user_id,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at
  };
}
