import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type ByoProbeStatus = "pending" | "active";

export interface ByoProbeRecord {
  id: string;
  workspaceId: string;
  name: string;
  region: string;
  status: ByoProbeStatus;
  lastSeenAt?: string;
  version?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterByoProbeResult {
  probe: ByoProbeRecord;
  token: string;
}

export interface ByoProbeRepository {
  register(input: { workspaceId: string; name: string; region: string }): Promise<RegisterByoProbeResult>;
  list(workspaceId: string): Promise<ByoProbeRecord[]>;
  heartbeat(input: { token: string; version?: string }): Promise<ByoProbeRecord | undefined>;
  authenticate(token: string): Promise<ByoProbeRecord | undefined>;
  close(): Promise<void>;
}

export async function createByoProbeRepository(): Promise<ByoProbeRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresByoProbeRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteByoProbeRepository(new DatabaseSync(config.databasePath));
}

class SqliteByoProbeRepository implements ByoProbeRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async register(input: { workspaceId: string; name: string; region: string }) {
    const now = new Date().toISOString();
    const token = createProbeToken();
    const id = randomUUID();
    this.db
      .prepare(
        `insert into byo_probes (id, workspace_id, name, region, token_hash, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(id, input.workspaceId, normalizeName(input.name), normalizeRegion(input.region), hashToken(token), now, now);
    const probe = (await this.list(input.workspaceId)).find((item) => item.id === id)!;
    return { probe, token };
  }

  async list(workspaceId: string) {
    const rows = this.db
      .prepare("select * from byo_probes where workspace_id = ? order by created_at desc")
      .all(workspaceId) as ByoProbeRow[];
    return rows.map(mapRow);
  }

  async heartbeat(input: { token: string; version?: string }) {
    const now = new Date().toISOString();
    const tokenHash = hashToken(input.token);
    this.db
      .prepare("update byo_probes set status = 'active', last_seen_at = ?, version = ?, updated_at = ? where token_hash = ?")
      .run(now, input.version ?? null, now, tokenHash);
    const row = this.db.prepare("select * from byo_probes where token_hash = ? limit 1").get(tokenHash) as ByoProbeRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async authenticate(token: string) {
    const row = this.db.prepare("select * from byo_probes where token_hash = ? limit 1").get(hashToken(token)) as
      | ByoProbeRow
      | undefined;
    return row ? mapRow(row) : undefined;
  }

  async close() {
    this.db.close();
  }
}

class PostgresByoProbeRepository implements ByoProbeRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async register(input: { workspaceId: string; name: string; region: string }) {
    const now = new Date().toISOString();
    const token = createProbeToken();
    const id = randomUUID();
    await this.sql`
      insert into byo_probes (id, workspace_id, name, region, token_hash, status, created_at, updated_at)
      values (${id}, ${input.workspaceId}, ${normalizeName(input.name)}, ${normalizeRegion(input.region)}, ${hashToken(token)}, 'pending', ${now}, ${now})
    `;
    const probe = (await this.list(input.workspaceId)).find((item) => item.id === id)!;
    return { probe, token };
  }

  async list(workspaceId: string) {
    const rows = await this.sql<ByoProbeRow[]>`
      select * from byo_probes where workspace_id = ${workspaceId} order by created_at desc
    `;
    return rows.map(mapRow);
  }

  async heartbeat(input: { token: string; version?: string }) {
    const now = new Date().toISOString();
    const rows = await this.sql<ByoProbeRow[]>`
      update byo_probes
      set status = 'active', last_seen_at = ${now}, version = ${input.version ?? null}, updated_at = ${now}
      where token_hash = ${hashToken(input.token)}
      returning *
    `;
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async authenticate(token: string) {
    const rows = await this.sql<ByoProbeRow[]>`
      select * from byo_probes where token_hash = ${hashToken(token)} limit 1
    `;
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async close() {
    await this.sql.end();
  }
}

interface ByoProbeRow {
  id: string;
  workspace_id: string;
  name: string;
  region: string;
  status: ByoProbeStatus;
  last_seen_at?: string | Date;
  version?: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeName(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 80) throw new Error("probe name must be 2-80 characters");
  return trimmed;
}

function normalizeRegion(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(trimmed)) throw new Error("probe region must be a short slug");
  return trimmed;
}

function createProbeToken() {
  return `mtp_${randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function iso(value: string | Date | undefined) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(row: ByoProbeRow): ByoProbeRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    region: row.region,
    status: row.status,
    lastSeenAt: iso(row.last_seen_at),
    version: row.version,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!
  };
}
