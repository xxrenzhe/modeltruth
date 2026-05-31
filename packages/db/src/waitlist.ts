import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type WaitlistStatus = "active" | "unsubscribed";

export interface WaitlistSignupRecord {
  id: string;
  email: string;
  role?: string;
  company?: string;
  source: string;
  status: WaitlistStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWaitlistSignupInput {
  email: string;
  role?: string;
  company?: string;
  source?: string;
}

export interface WaitlistRepository {
  create(input: CreateWaitlistSignupInput): Promise<WaitlistSignupRecord>;
  listActive(limit?: number): Promise<WaitlistSignupRecord[]>;
  close(): Promise<void>;
}

export async function createWaitlistRepository(): Promise<WaitlistRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresWaitlistRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteWaitlistRepository(new DatabaseSync(config.databasePath));
}

class SqliteWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: { prepare(sql: string): any; close(): void }) {}

  async create(input: CreateWaitlistSignupInput): Promise<WaitlistSignupRecord> {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    this.db
      .prepare(
        `insert into waitlist_signups (id, email, role, company, source, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'active', ?, ?)
         on conflict(email) do update set
           role = coalesce(excluded.role, waitlist_signups.role),
           company = coalesce(excluded.company, waitlist_signups.company),
           source = excluded.source,
           status = 'active',
           updated_at = excluded.updated_at`
      )
      .run(
        crypto.randomUUID(),
        email,
        nullableText(input.role),
        nullableText(input.company),
        cleanSource(input.source),
        now,
        now
      );
    return this.getByEmail(email);
  }

  async listActive(limit = 100): Promise<WaitlistSignupRecord[]> {
    const rows = this.db
      .prepare("select * from waitlist_signups where status = 'active' order by created_at desc limit ?")
      .all(Math.min(Math.max(limit, 1), 1000)) as WaitlistRow[];
    return rows.map(mapRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private getByEmail(email: string) {
    const row = this.db.prepare("select * from waitlist_signups where email = ? limit 1").get(email) as WaitlistRow;
    return mapRow(row);
  }
}

class PostgresWaitlistRepository implements WaitlistRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async create(input: CreateWaitlistSignupInput): Promise<WaitlistSignupRecord> {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    const query = this.sql<WaitlistRow[]>`
      insert into waitlist_signups (id, email, role, company, source, status, created_at, updated_at)
      values (
        ${crypto.randomUUID()}, ${email}, ${nullableText(input.role)}, ${nullableText(input.company)},
        ${cleanSource(input.source)}, 'active', ${now}, ${now}
      )
      on conflict (email) do update set
        role = coalesce(excluded.role, waitlist_signups.role),
        company = coalesce(excluded.company, waitlist_signups.company),
        source = excluded.source,
        status = 'active',
        updated_at = excluded.updated_at
      returning *
    `;
    const rows = await query;
    return mapRow(rows[0]);
  }

  async listActive(limit = 100): Promise<WaitlistSignupRecord[]> {
    const rows = await this.sql<WaitlistRow[]>`
      select * from waitlist_signups
      where status = 'active'
      order by created_at desc
      limit ${Math.min(Math.max(limit, 1), 1000)}
    `;
    return rows.map(mapRow);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface WaitlistRow {
  id: string;
  email: string;
  role?: string;
  company?: string;
  source: string;
  status: WaitlistStatus;
  created_at: string;
  updated_at: string;
}

function mapRow(row: WaitlistRow): WaitlistSignupRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role ?? undefined,
    company: row.company ?? undefined,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("valid email is required");
  return email;
}

function cleanOptional(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

function nullableText(value: string | undefined) {
  return cleanOptional(value) ?? null;
}

function cleanSource(value: string | undefined) {
  const source = value?.trim().toLowerCase() || "homepage";
  return /^[a-z0-9_.:-]{2,80}$/.test(source) ? source : "homepage";
}
