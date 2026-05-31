import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface PlaygroundQuotaResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: string;
}

export interface PlaygroundQuotaRepository {
  consume(quotaKey: string, limit?: number, windowMs?: number): Promise<PlaygroundQuotaResult>;
  close(): Promise<void>;
}

export async function createPlaygroundQuotaRepository(): Promise<PlaygroundQuotaRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresPlaygroundQuotaRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqlitePlaygroundQuotaRepository(new DatabaseSync(config.databasePath));
}

class SqlitePlaygroundQuotaRepository implements PlaygroundQuotaRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {}

  async consume(quotaKey: string, limit = 3, windowMs = 24 * 60 * 60 * 1000): Promise<PlaygroundQuotaResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("select count(*) as count from playground_quota_events where quota_key = ? and created_at >= ?")
        .get(quotaKey, cutoff) as { count: number };
      if (row.count >= limit) {
        this.db.exec("COMMIT");
        return { allowed: false, remaining: 0, limit, resetAt: new Date(now.getTime() + windowMs).toISOString() };
      }
      this.db
        .prepare("insert into playground_quota_events (id, quota_key, created_at) values (?, ?, ?)")
        .run(crypto.randomUUID(), quotaKey, now.toISOString());
      this.db.exec("COMMIT");
      return { allowed: true, remaining: Math.max(0, limit - row.count - 1), limit, resetAt: new Date(now.getTime() + windowMs).toISOString() };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresPlaygroundQuotaRepository implements PlaygroundQuotaRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async consume(quotaKey: string, limit = 3, windowMs = 24 * 60 * 60 * 1000): Promise<PlaygroundQuotaResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const count = await this.sql.begin(async (tx) => {
      const rows = await tx<{ count: string }[]>`
        select count(*)::text as count from playground_quota_events
        where quota_key = ${quotaKey} and created_at >= ${cutoff}
      `;
      const used = Number(rows[0]?.count ?? 0);
      if (used >= limit) return used;
      await tx`
        insert into playground_quota_events (id, quota_key, created_at)
        values (${crypto.randomUUID()}, ${quotaKey}, ${now.toISOString()})
      `;
      return used;
    });
    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count - (count < limit ? 1 : 0)),
      limit,
      resetAt: new Date(now.getTime() + windowMs).toISOString()
    };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
