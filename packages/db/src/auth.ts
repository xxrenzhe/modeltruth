import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  tier: string;
}

export interface AuthSession {
  id: string;
  expiresAt: string;
  user: AuthUser;
  workspace: AuthWorkspace;
}

export interface MagicLink {
  token: string;
  email: string;
  expiresAt: string;
}

export interface AuthRepository {
  createMagicLink(email: string, ttlSeconds?: number): Promise<MagicLink>;
  consumeMagicLink(token: string, ttlSeconds?: number): Promise<{ sessionToken: string; session: AuthSession } | undefined>;
  getSession(sessionToken: string): Promise<AuthSession | undefined>;
  destroySession(sessionToken: string): Promise<void>;
  close(): Promise<void>;
}

export async function createAuthRepository(): Promise<AuthRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresAuthRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteAuthRepository(new DatabaseSync(config.databasePath));
}

class SqliteAuthRepository implements AuthRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async createMagicLink(email: string, ttlSeconds = 900): Promise<MagicLink> {
    const normalizedEmail = normalizeEmail(email);
    const token = createToken();
    const now = nowIso();
    const expiresAt = addSeconds(now, ttlSeconds);
    this.db
      .prepare("insert into auth_magic_links (id, email, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)")
      .run(randomUUID(), normalizedEmail, hashToken(token), expiresAt, now);
    return { token, email: normalizedEmail, expiresAt };
  }

  async consumeMagicLink(token: string, ttlSeconds = 60 * 60 * 24 * 30) {
    const tokenHash = hashToken(token);
    const now = nowIso();
    const link = this.db
      .prepare("select * from auth_magic_links where token_hash = ? and consumed_at is null and expires_at > ? limit 1")
      .get(tokenHash, now) as MagicLinkRow | undefined;
    if (!link) return undefined;

    let sessionToken = "";
    let sessionId = "";
    this.db.exec("BEGIN");
    try {
      const user = this.ensureUser(link.email, now);
      const workspace = this.ensureWorkspace(user.id, user.email, now);
      sessionToken = createToken();
      sessionId = randomUUID();
      this.db
        .prepare(
          `insert into auth_sessions (id, user_id, workspace_id, token_hash, expires_at, created_at, last_seen_at)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(sessionId, user.id, workspace.id, hashToken(sessionToken), addSeconds(now, ttlSeconds), now, now);
      this.db.prepare("update auth_magic_links set consumed_at = ? where id = ?").run(now, link.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const session = await this.getSession(sessionToken);
    return session ? { sessionToken, session } : undefined;
  }

  async getSession(sessionToken: string): Promise<AuthSession | undefined> {
    const now = nowIso();
    const row = this.db
      .prepare(
        `select
          s.id as session_id, s.expires_at,
          u.id as user_id, u.email, u.name,
          w.id as workspace_id, w.name as workspace_name, w.tier
        from auth_sessions s
        join users u on u.id = s.user_id
        join workspaces w on w.id = s.workspace_id
        where s.token_hash = ? and s.expires_at > ?
        limit 1`
      )
      .get(hashToken(sessionToken), now) as SessionRow | undefined;
    if (!row) return undefined;
    this.db.prepare("update auth_sessions set last_seen_at = ? where id = ?").run(now, row.session_id);
    return mapSessionRow(row);
  }

  async destroySession(sessionToken: string): Promise<void> {
    this.db.prepare("delete from auth_sessions where token_hash = ?").run(hashToken(sessionToken));
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private ensureUser(email: string, now: string): AuthUser {
    const existing = this.db.prepare("select id, email, name from users where email = ? limit 1").get(email) as AuthUser | undefined;
    if (existing) return existing;
    const user = { id: randomUUID(), email, name: emailName(email) };
    this.db
      .prepare("insert into users (id, email, name, created_at, updated_at) values (?, ?, ?, ?, ?)")
      .run(user.id, user.email, user.name, now, now);
    return user;
  }

  private ensureWorkspace(ownerId: string, email: string, now: string): AuthWorkspace {
    const existing = this.db
      .prepare("select id, name, tier from workspaces where owner_id = ? order by created_at asc limit 1")
      .get(ownerId) as AuthWorkspace | undefined;
    if (existing) return existing;
    const workspace = { id: randomUUID(), name: `${emailName(email)} Workspace`, tier: "free" };
    this.db
      .prepare("insert into workspaces (id, owner_id, name, tier, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
      .run(workspace.id, ownerId, workspace.name, workspace.tier, now, now);
    return workspace;
  }
}

class PostgresAuthRepository implements AuthRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async createMagicLink(email: string, ttlSeconds = 900): Promise<MagicLink> {
    const normalizedEmail = normalizeEmail(email);
    const token = createToken();
    const now = nowIso();
    const expiresAt = addSeconds(now, ttlSeconds);
    await this.sql`
      insert into auth_magic_links (id, email, token_hash, expires_at, created_at)
      values (${randomUUID()}, ${normalizedEmail}, ${hashToken(token)}, ${expiresAt}, ${now})
    `;
    return { token, email: normalizedEmail, expiresAt };
  }

  async consumeMagicLink(token: string, ttlSeconds = 60 * 60 * 24 * 30) {
    const tokenHash = hashToken(token);
    const now = nowIso();
    let sessionToken = "";
    await this.sql.begin(async (tx) => {
      const links = await tx<MagicLinkRow[]>`
        select * from auth_magic_links
        where token_hash = ${tokenHash} and consumed_at is null and expires_at > ${now}
        limit 1
      `;
      const link = links[0];
      if (!link) return;

      const user = await ensurePostgresUser(tx, link.email, now);
      const workspace = await ensurePostgresWorkspace(tx, user.id, user.email, now);
      sessionToken = createToken();
      await tx`
        insert into auth_sessions (id, user_id, workspace_id, token_hash, expires_at, created_at, last_seen_at)
        values (${randomUUID()}, ${user.id}, ${workspace.id}, ${hashToken(sessionToken)}, ${addSeconds(now, ttlSeconds)}, ${now}, ${now})
      `;
      await tx`update auth_magic_links set consumed_at = ${now} where id = ${link.id}`;
    });

    if (!sessionToken) return undefined;
    const session = await this.getSession(sessionToken);
    return session ? { sessionToken, session } : undefined;
  }

  async getSession(sessionToken: string): Promise<AuthSession | undefined> {
    const now = nowIso();
    const rows = await this.sql<SessionRow[]>`
      select
        s.id as session_id, s.expires_at,
        u.id as user_id, u.email, u.name,
        w.id as workspace_id, w.name as workspace_name, w.tier
      from auth_sessions s
      join users u on u.id = s.user_id
      join workspaces w on w.id = s.workspace_id
      where s.token_hash = ${hashToken(sessionToken)} and s.expires_at > ${now}
      limit 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    await this.sql`update auth_sessions set last_seen_at = ${now} where id = ${row.session_id}`;
    return mapSessionRow(row);
  }

  async destroySession(sessionToken: string): Promise<void> {
    await this.sql`delete from auth_sessions where token_hash = ${hashToken(sessionToken)}`;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

async function ensurePostgresUser(tx: postgres.TransactionSql, email: string, now: string): Promise<AuthUser> {
  const existing = await tx<AuthUser[]>`select id, email, name from users where email = ${email} limit 1`;
  if (existing[0]) return existing[0];
  const user = { id: randomUUID(), email, name: emailName(email) };
  await tx`
    insert into users (id, email, name, created_at, updated_at)
    values (${user.id}, ${user.email}, ${user.name}, ${now}, ${now})
  `;
  return user;
}

async function ensurePostgresWorkspace(
  tx: postgres.TransactionSql,
  ownerId: string,
  email: string,
  now: string
): Promise<AuthWorkspace> {
  const existing = await tx<AuthWorkspace[]>`
    select id, name, tier from workspaces where owner_id = ${ownerId} order by created_at asc limit 1
  `;
  if (existing[0]) return existing[0];
  const workspace = { id: randomUUID(), name: `${emailName(email)} Workspace`, tier: "free" };
  await tx`
    insert into workspaces (id, owner_id, name, tier, created_at, updated_at)
    values (${workspace.id}, ${ownerId}, ${workspace.name}, ${workspace.tier}, ${now}, ${now})
  `;
  return workspace;
}

interface MagicLinkRow {
  id: string;
  email: string;
}

interface SessionRow {
  session_id: string;
  expires_at: string | Date;
  user_id: string;
  email: string;
  name?: string;
  workspace_id: string;
  workspace_name: string;
  tier: string;
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error("Invalid email");
  return normalized;
}

function createToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function addSeconds(iso: string, seconds: number) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function emailName(email: string) {
  return email.split("@")[0] || "ModelTruth";
}

function mapSessionRow(row: SessionRow): AuthSession {
  return {
    id: row.session_id,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    user: { id: row.user_id, email: row.email, name: row.name },
    workspace: { id: row.workspace_id, name: row.workspace_name, tier: row.tier }
  };
}
