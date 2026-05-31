import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type ProviderSubscriptionStatus = "active" | "unsubscribed";
export type ProviderNotificationType = "risk_trend" | "weekly_digest";

export interface ProviderSubscriptionRecord {
  id: string;
  providerSlug: string;
  email: string;
  notificationType: ProviderNotificationType;
  status: ProviderSubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderSubscriptionInput {
  providerSlug: string;
  email: string;
  notificationType?: ProviderNotificationType;
}

export interface ProviderSubscriptionRepository {
  create(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionRecord>;
  listByProvider(providerSlug: string): Promise<ProviderSubscriptionRecord[]>;
  listByProviderAndType(providerSlug: string, notificationType: ProviderNotificationType): Promise<ProviderSubscriptionRecord[]>;
  listByEmail(email: string): Promise<ProviderSubscriptionRecord[]>;
  close(): Promise<void>;
}

export async function createProviderSubscriptionRepository(): Promise<ProviderSubscriptionRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresProviderSubscriptionRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteProviderSubscriptionRepository(new DatabaseSync(config.databasePath));
}

class SqliteProviderSubscriptionRepository implements ProviderSubscriptionRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {}

  async create(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const notificationType = input.notificationType ?? "risk_trend";
    this.db
      .prepare(
        `insert into provider_subscriptions (id, provider_slug, email, notification_type, status, created_at, updated_at)
         values (?, ?, ?, ?, 'active', ?, ?)
         on conflict(provider_slug, email, notification_type) do update set status = 'active', updated_at = excluded.updated_at`
      )
      .run(id, input.providerSlug, input.email, notificationType, now, now);
    return (await this.listByProvider(input.providerSlug)).find(
      (item) => item.email === input.email && item.notificationType === notificationType
    )!;
  }

  async listByProvider(providerSlug: string): Promise<ProviderSubscriptionRecord[]> {
    const rows = this.db
      .prepare("select * from provider_subscriptions where provider_slug = ? and status = 'active' order by created_at desc")
      .all(providerSlug) as ProviderSubscriptionRow[];
    return rows.map(mapRow);
  }

  async listByProviderAndType(providerSlug: string, notificationType: ProviderNotificationType): Promise<ProviderSubscriptionRecord[]> {
    const rows = this.db
      .prepare(
        `select * from provider_subscriptions
         where provider_slug = ? and notification_type = ? and status = 'active'
         order by created_at desc`
      )
      .all(providerSlug, notificationType) as ProviderSubscriptionRow[];
    return rows.map(mapRow);
  }

  async listByEmail(email: string): Promise<ProviderSubscriptionRecord[]> {
    const rows = this.db
      .prepare("select * from provider_subscriptions where email = ? and status = 'active' order by created_at desc")
      .all(email) as ProviderSubscriptionRow[];
    return rows.map(mapRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresProviderSubscriptionRepository implements ProviderSubscriptionRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async create(input: CreateProviderSubscriptionInput): Promise<ProviderSubscriptionRecord> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const notificationType = input.notificationType ?? "risk_trend";
    await this.sql`
      insert into provider_subscriptions (id, provider_slug, email, notification_type, status, created_at, updated_at)
      values (${id}, ${input.providerSlug}, ${input.email}, ${notificationType}, 'active', ${now}, ${now})
      on conflict (provider_slug, email, notification_type) do update set status = 'active', updated_at = excluded.updated_at
    `;
    return (await this.listByProvider(input.providerSlug)).find(
      (item) => item.email === input.email && item.notificationType === notificationType
    )!;
  }

  async listByProvider(providerSlug: string): Promise<ProviderSubscriptionRecord[]> {
    const rows = await this.sql<ProviderSubscriptionRow[]>`
      select * from provider_subscriptions
      where provider_slug = ${providerSlug} and status = 'active'
      order by created_at desc
    `;
    return rows.map(mapRow);
  }

  async listByProviderAndType(providerSlug: string, notificationType: ProviderNotificationType): Promise<ProviderSubscriptionRecord[]> {
    const rows = await this.sql<ProviderSubscriptionRow[]>`
      select * from provider_subscriptions
      where provider_slug = ${providerSlug} and notification_type = ${notificationType} and status = 'active'
      order by created_at desc
    `;
    return rows.map(mapRow);
  }

  async listByEmail(email: string): Promise<ProviderSubscriptionRecord[]> {
    const rows = await this.sql<ProviderSubscriptionRow[]>`
      select * from provider_subscriptions
      where email = ${email} and status = 'active'
      order by created_at desc
    `;
    return rows.map(mapRow);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface ProviderSubscriptionRow {
  id: string;
  provider_slug: string;
  email: string;
  notification_type: ProviderNotificationType;
  status: ProviderSubscriptionStatus;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ProviderSubscriptionRow): ProviderSubscriptionRecord {
  return {
    id: row.id,
    providerSlug: row.provider_slug,
    email: row.email,
    notificationType: row.notification_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
