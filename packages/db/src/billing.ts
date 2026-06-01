import { createHash } from "node:crypto";
import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface WorkspaceBilling {
  workspaceId: string;
  tier: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus: string;
}

export interface UpdateWorkspaceBillingInput {
  workspaceId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus: string;
  tier?: string;
}

export interface BillingRepository {
  getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBilling | undefined>;
  updateWorkspaceBilling(input: UpdateWorkspaceBillingInput): Promise<void>;
  markStripeEventProcessed(eventId: string, type: string, rawPayload: string): Promise<boolean>;
  close(): Promise<void>;
}

export async function createBillingRepository(): Promise<BillingRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresBillingRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteBillingRepository(new DatabaseSync(config.databasePath));
}

class SqliteBillingRepository implements BillingRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBilling | undefined> {
    const row = this.db.prepare("select * from workspaces where id = ? limit 1").get(workspaceId) as WorkspaceBillingRow | undefined;
    return row ? mapBillingRow(row) : undefined;
  }

  async updateWorkspaceBilling(input: UpdateWorkspaceBillingInput): Promise<void> {
    const now = new Date().toISOString();
    const tier = resolveTier(input.subscriptionStatus, input.tier, this.currentTier(input));
    if (input.workspaceId) {
      this.db
        .prepare(
          `update workspaces
           set tier = ?, stripe_customer_id = coalesce(?, stripe_customer_id),
               stripe_subscription_id = coalesce(?, stripe_subscription_id),
               subscription_status = ?, updated_at = ?
           where id = ?`
        )
        .run(tier, input.stripeCustomerId ?? null, input.stripeSubscriptionId ?? null, input.subscriptionStatus, now, input.workspaceId);
      return;
    }

    this.db
      .prepare(
        `update workspaces
         set tier = ?, stripe_customer_id = coalesce(?, stripe_customer_id),
             stripe_subscription_id = coalesce(?, stripe_subscription_id),
             subscription_status = ?, updated_at = ?
         where stripe_subscription_id = ? or stripe_customer_id = ?`
      )
      .run(
        tier,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.subscriptionStatus,
        now,
        input.stripeSubscriptionId ?? "",
        input.stripeCustomerId ?? ""
      );
  }

  async markStripeEventProcessed(eventId: string, type: string, rawPayload: string): Promise<boolean> {
    try {
      this.db
        .prepare("insert into stripe_events (id, type, processed_at, payload_hash) values (?, ?, ?, ?)")
        .run(eventId, type, new Date().toISOString(), payloadHash(rawPayload));
      return true;
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) return false;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private currentTier(input: UpdateWorkspaceBillingInput): string {
    if (input.workspaceId) {
      const row = this.db.prepare("select tier from workspaces where id = ? limit 1").get(input.workspaceId) as { tier?: string } | undefined;
      return row?.tier ?? "free";
    }
    const row = this.db
      .prepare("select tier from workspaces where stripe_subscription_id = ? or stripe_customer_id = ? limit 1")
      .get(input.stripeSubscriptionId ?? "", input.stripeCustomerId ?? "") as { tier?: string } | undefined;
    return row?.tier ?? "free";
  }
}

class PostgresBillingRepository implements BillingRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBilling | undefined> {
    const rows = await this.sql<WorkspaceBillingRow[]>`select * from workspaces where id = ${workspaceId} limit 1`;
    return rows[0] ? mapBillingRow(rows[0]) : undefined;
  }

  async updateWorkspaceBilling(input: UpdateWorkspaceBillingInput): Promise<void> {
    const tier = resolveTier(input.subscriptionStatus, input.tier, await this.currentTier(input));
    if (input.workspaceId) {
      await this.sql`
        update workspaces
        set tier = ${tier}, stripe_customer_id = coalesce(${input.stripeCustomerId ?? null}, stripe_customer_id),
            stripe_subscription_id = coalesce(${input.stripeSubscriptionId ?? null}, stripe_subscription_id),
            subscription_status = ${input.subscriptionStatus}, updated_at = ${new Date().toISOString()}
        where id = ${input.workspaceId}
      `;
      return;
    }

    await this.sql`
      update workspaces
      set tier = ${tier}, stripe_customer_id = coalesce(${input.stripeCustomerId ?? null}, stripe_customer_id),
          stripe_subscription_id = coalesce(${input.stripeSubscriptionId ?? null}, stripe_subscription_id),
          subscription_status = ${input.subscriptionStatus}, updated_at = ${new Date().toISOString()}
      where stripe_subscription_id = ${input.stripeSubscriptionId ?? ""} or stripe_customer_id = ${input.stripeCustomerId ?? ""}
    `;
  }

  async markStripeEventProcessed(eventId: string, type: string, rawPayload: string): Promise<boolean> {
    const rows = await this.sql`
      insert into stripe_events (id, type, processed_at, payload_hash)
      values (${eventId}, ${type}, ${new Date().toISOString()}, ${payloadHash(rawPayload)})
      on conflict (id) do nothing
      returning id
    `;
    return rows.length > 0;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private async currentTier(input: UpdateWorkspaceBillingInput): Promise<string> {
    if (input.workspaceId) {
      const rows = await this.sql<{ tier?: string }[]>`select tier from workspaces where id = ${input.workspaceId} limit 1`;
      return rows[0]?.tier ?? "free";
    }
    const rows = await this.sql<{ tier?: string }[]>`
      select tier from workspaces
      where stripe_subscription_id = ${input.stripeSubscriptionId ?? ""} or stripe_customer_id = ${input.stripeCustomerId ?? ""}
      limit 1
    `;
    return rows[0]?.tier ?? "free";
  }
}

interface WorkspaceBillingRow {
  id: string;
  tier: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status: string;
}

function mapBillingRow(row: WorkspaceBillingRow): WorkspaceBilling {
  return {
    workspaceId: row.id,
    tier: row.tier,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status
  };
}

function resolveTier(status: string, tier = "free", currentTier = "free") {
  if (status !== "active" && status !== "trialing") return "free";
  if (tier === "pro" || tier === "team") return tier;
  if (currentTier === "pro" || currentTier === "team") return currentTier;
  return "free";
}

function payloadHash(rawPayload: string) {
  return createHash("sha256").update(rawPayload).digest("hex");
}
