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
  launch: {
    monthlyVisits: number;
    dashboardWeeklyActiveVisitors: number;
    githubStars: number;
    packageDownloads: number;
  };
  beta30Targets: {
    auditRunsTarget: 1000;
    proSubscriptionsTarget: 20;
    mrrUsdTarget: 380;
    auditRunsProgress: number;
    proSubscriptionsProgress: number;
    mrrProgress: number;
  };
  launch90Targets: {
    monthlyVisitsTarget: 10000;
    paidSubscriptionsTarget: 100;
    mrrUsdTarget: 2500;
    cliStarsOrDownloadsTarget: 1000;
    dashboardWeeklyActiveVisitorsTarget: 2000;
    monthlyVisitsProgress: number;
    paidSubscriptionsProgress: number;
    mrrProgress: number;
    cliStarsOrDownloadsProgress: number;
    dashboardWeeklyActiveVisitorsProgress: number;
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
      return snapshotFromCounts(now, windowDays, await postgresCounts(sql, since, now));
    } finally {
      await sql.end();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(config.databasePath);
  try {
    return snapshotFromCounts(now, windowDays, sqliteCounts(db, since, now));
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
  monthlyVisits: number;
  dashboardWeeklyActiveVisitors: number;
  githubStars: number;
  packageDownloads: number;
}

function sqliteCounts(db: { prepare(sql: string): any }, since: string, now: Date): GtmCounts {
  const since30 = daysAgo(now, 30).slice(0, 10);
  const since7 = daysAgo(now, 7).slice(0, 10);
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
    ),
    monthlyVisits: sqliteCount(db, "select coalesce(sum(visit_count), 0) as count from gtm_daily_visitors where day >= ?", [since30]),
    dashboardWeeklyActiveVisitors: sqliteCount(
      db,
      "select count(distinct visitor_hash) as count from gtm_daily_visitors where day >= ? and surface in ('public_dashboard','provider_board')",
      [since7]
    ),
    githubStars: sqliteCount(db, "select coalesce(max(metric_value), 0) as count from gtm_external_metric_snapshots where source = 'github_stars'", []),
    packageDownloads: sqliteCount(db, "select coalesce(max(metric_value), 0) as count from gtm_external_metric_snapshots where source = 'package_downloads'", [])
  };
}

async function postgresCounts(sql: postgres.Sql, since: string, now: Date): Promise<GtmCounts> {
  const since30 = daysAgo(now, 30).slice(0, 10);
  const since7 = daysAgo(now, 7).slice(0, 10);
  const [auditRuns, playgroundAuditRuns, cliAuditRuns, playgroundWarningOrFailRuns, firstPaidNodeActivations, providerSubscriptions, waitlistSignups, proSubscriptions, teamSubscriptions, monthlyVisits, dashboardWeeklyActiveVisitors, githubStars, packageDownloads] =
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
      pgCount(sql, sql`select count(*)::int as count from workspaces where tier = 'team' and subscription_status in ('active','trialing')`),
      pgCount(sql, sql`select coalesce(sum(visit_count), 0)::int as count from gtm_daily_visitors where day >= ${since30}`),
      pgCount(
        sql,
        sql`select count(distinct visitor_hash)::int as count from gtm_daily_visitors where day >= ${since7} and surface in ('public_dashboard','provider_board')`
      ),
      pgCount(sql, sql`select coalesce(max(metric_value), 0)::int as count from gtm_external_metric_snapshots where source = 'github_stars'`),
      pgCount(sql, sql`select coalesce(max(metric_value), 0)::int as count from gtm_external_metric_snapshots where source = 'package_downloads'`)
    ]);
  return {
    auditRuns,
    playgroundAuditRuns,
    cliAuditRuns,
    playgroundWarningOrFailRuns,
    firstPaidNodeActivations,
    providerSubscriptions,
    waitlistSignups,
    proSubscriptions,
    teamSubscriptions,
    monthlyVisits,
    dashboardWeeklyActiveVisitors,
    githubStars,
    packageDownloads
  };
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
    launch: {
      monthlyVisits: counts.monthlyVisits,
      dashboardWeeklyActiveVisitors: counts.dashboardWeeklyActiveVisitors,
      githubStars: counts.githubStars,
      packageDownloads: counts.packageDownloads
    },
    beta30Targets: {
      auditRunsTarget: 1000,
      proSubscriptionsTarget: 20,
      mrrUsdTarget: 380,
      auditRunsProgress: ratio(counts.auditRuns, 1000),
      proSubscriptionsProgress: ratio(counts.proSubscriptions, 20),
      mrrProgress: ratio(mrrUsd, 380)
    },
    launch90Targets: {
      monthlyVisitsTarget: 10000,
      paidSubscriptionsTarget: 100,
      mrrUsdTarget: 2500,
      cliStarsOrDownloadsTarget: 1000,
      dashboardWeeklyActiveVisitorsTarget: 2000,
      monthlyVisitsProgress: ratio(counts.monthlyVisits, 10000),
      paidSubscriptionsProgress: ratio(paidSubscriptions, 100),
      mrrProgress: ratio(mrrUsd, 2500),
      cliStarsOrDownloadsProgress: ratio(Math.max(counts.githubStars, counts.packageDownloads), 1000),
      dashboardWeeklyActiveVisitorsProgress: ratio(counts.dashboardWeeklyActiveVisitors, 2000)
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

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
