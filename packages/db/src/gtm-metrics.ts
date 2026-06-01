import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export interface GtmMetricsSnapshot {
  schemaVersion: "modeltruth.gtm-metrics.v1";
  generatedAt: string;
  windowDays: number;
  activation: {
    auditRuns: number;
    playgroundAuditRuns: number;
    cliAuditRuns: number;
    playgroundWarningOrFailRuns: number;
    firstPaidNodeActivations: number;
    providerSubscriptions: number;
    waitlistSignups: number;
  };
  revenue: {
    proSubscriptions: number;
    teamSubscriptions: number;
    paidSubscriptions: number;
    mrrUsd: number;
  };
  beta30Targets: {
    auditRunsTarget: 1000;
    proSubscriptionsTarget: 20;
    mrrUsdTarget: 380;
    auditRunsProgress: number;
    proSubscriptionsProgress: number;
    mrrProgress: number;
  };
  privacy: {
    storesRawEndpointPath: false;
    storesHeaders: false;
    storesRequestBody: false;
    storesEmailInResponse: false;
  };
}

export async function buildGtmMetricsSnapshot(options: { now?: Date; windowDays?: number } = {}): Promise<GtmMetricsSnapshot> {
  const config = getAppConfig();
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 30;
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  if (config.databaseUrl) {
    const sql = postgres(config.databaseUrl, { max: 1 });
    try {
      return snapshotFromCounts(now, windowDays, await postgresCounts(sql, since));
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    return snapshotFromCounts(now, windowDays, sqliteCounts(db, since));
  } finally {
    db.close();
  }
}

interface GtmCounts {
  auditRuns: number;
  playgroundAuditRuns: number;
  cliAuditRuns: number;
  playgroundWarningOrFailRuns: number;
  firstPaidNodeActivations: number;
  providerSubscriptions: number;
  waitlistSignups: number;
  proSubscriptions: number;
  teamSubscriptions: number;
}

function sqliteCounts(db: { prepare(sql: string): any }, since: string): GtmCounts {
  return {
    auditRuns: sqliteCount(db, "select count(*) as count from audit_runs where created_at >= ?", [since]),
    playgroundAuditRuns: sqliteCount(db, "select count(*) as count from audit_runs where created_at >= ? and run_type = 'playground'", [since]),
    cliAuditRuns: sqliteCount(db, "select count(*) as count from audit_runs where created_at >= ? and run_type = 'cli'", [since]),
    playgroundWarningOrFailRuns: sqliteCount(
      db,
      "select count(*) as count from audit_runs where created_at >= ? and run_type = 'playground' and status in ('warning','fail','error')",
      [since]
    ),
    firstPaidNodeActivations: sqliteCount(
      db,
      `select count(*) as count
       from (
         select pn.workspace_id
         from provider_nodes pn
         join workspaces w on w.id = pn.workspace_id
         where pn.status = 'active' and w.tier in ('pro','team') and w.subscription_status in ('active','trialing')
         group by pn.workspace_id
         having min(pn.created_at) >= ?
       )`,
      [since]
    ),
    providerSubscriptions: sqliteCount(db, "select count(*) as count from provider_subscriptions where status = 'active' and created_at >= ?", [since]),
    waitlistSignups: sqliteCount(db, "select count(*) as count from waitlist_signups where status = 'active' and created_at >= ?", [since]),
    proSubscriptions: sqliteCount(
      db,
      "select count(*) as count from workspaces where tier = 'pro' and subscription_status in ('active','trialing')",
      []
    ),
    teamSubscriptions: sqliteCount(
      db,
      "select count(*) as count from workspaces where tier = 'team' and subscription_status in ('active','trialing')",
      []
    )
  };
}

async function postgresCounts(sql: postgres.Sql, since: string): Promise<GtmCounts> {
  const [auditRuns, playgroundAuditRuns, cliAuditRuns, playgroundWarningOrFailRuns, firstPaidNodeActivations, providerSubscriptions, waitlistSignups, proSubscriptions, teamSubscriptions] =
    await Promise.all([
      pgCount(sql, sql`select count(*)::int as count from audit_runs where created_at >= ${since}`),
      pgCount(sql, sql`select count(*)::int as count from audit_runs where created_at >= ${since} and run_type = 'playground'`),
      pgCount(sql, sql`select count(*)::int as count from audit_runs where created_at >= ${since} and run_type = 'cli'`),
      pgCount(
        sql,
        sql`select count(*)::int as count from audit_runs where created_at >= ${since} and run_type = 'playground' and status in ('warning','fail','error')`
      ),
      pgCount(
        sql,
        sql`
          select count(*)::int as count
          from (
            select pn.workspace_id
            from provider_nodes pn
            join workspaces w on w.id = pn.workspace_id
            where pn.status = 'active' and w.tier in ('pro','team') and w.subscription_status in ('active','trialing')
            group by pn.workspace_id
            having min(pn.created_at) >= ${since}
          ) activations
        `
      ),
      pgCount(sql, sql`select count(*)::int as count from provider_subscriptions where status = 'active' and created_at >= ${since}`),
      pgCount(sql, sql`select count(*)::int as count from waitlist_signups where status = 'active' and created_at >= ${since}`),
      pgCount(sql, sql`select count(*)::int as count from workspaces where tier = 'pro' and subscription_status in ('active','trialing')`),
      pgCount(sql, sql`select count(*)::int as count from workspaces where tier = 'team' and subscription_status in ('active','trialing')`)
    ]);
  return { auditRuns, playgroundAuditRuns, cliAuditRuns, playgroundWarningOrFailRuns, firstPaidNodeActivations, providerSubscriptions, waitlistSignups, proSubscriptions, teamSubscriptions };
}

function sqliteCount(db: { prepare(sql: string): any }, query: string, params: unknown[]) {
  const row = db.prepare(query).get(...params) as { count: number };
  return Number(row.count);
}

async function pgCount(_sql: postgres.Sql, query: Promise<Array<{ count: number }>>) {
  const rows = await query;
  return Number(rows[0]?.count ?? 0);
}

function snapshotFromCounts(now: Date, windowDays: number, counts: GtmCounts): GtmMetricsSnapshot {
  const paidSubscriptions = counts.proSubscriptions + counts.teamSubscriptions;
  const mrrUsd = counts.proSubscriptions * 19 + counts.teamSubscriptions * 79;
  return {
    schemaVersion: "modeltruth.gtm-metrics.v1",
    generatedAt: now.toISOString(),
    windowDays,
    activation: {
      auditRuns: counts.auditRuns,
      playgroundAuditRuns: counts.playgroundAuditRuns,
      cliAuditRuns: counts.cliAuditRuns,
      playgroundWarningOrFailRuns: counts.playgroundWarningOrFailRuns,
      firstPaidNodeActivations: counts.firstPaidNodeActivations,
      providerSubscriptions: counts.providerSubscriptions,
      waitlistSignups: counts.waitlistSignups
    },
    revenue: {
      proSubscriptions: counts.proSubscriptions,
      teamSubscriptions: counts.teamSubscriptions,
      paidSubscriptions,
      mrrUsd
    },
    beta30Targets: {
      auditRunsTarget: 1000,
      proSubscriptionsTarget: 20,
      mrrUsdTarget: 380,
      auditRunsProgress: ratio(counts.auditRuns, 1000),
      proSubscriptionsProgress: ratio(counts.proSubscriptions, 20),
      mrrProgress: ratio(mrrUsd, 380)
    },
    privacy: {
      storesRawEndpointPath: false,
      storesHeaders: false,
      storesRequestBody: false,
      storesEmailInResponse: false
    }
  };
}

function ratio(value: number, target: number) {
  return Math.min(value / target, 1);
}
