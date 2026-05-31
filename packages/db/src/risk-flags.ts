import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";

export type RiskFlagStatus = "active" | "acknowledged" | "disputed" | "under_review" | "resolved" | "upheld";
export type RiskFlagSeverity = "warning" | "fail" | "error";
export type RiskFlagEventType = "created" | "evidence_added" | "acknowledged" | "disputed" | "under_review" | "resolved" | "upheld";

export interface RiskFlagRecord {
  id: string;
  workspaceId?: string;
  nodeId?: string;
  providerSlug?: string;
  assertionId: string;
  severity: RiskFlagSeverity;
  status: RiskFlagStatus;
  targetModelId?: string;
  suiteId?: string;
  firstRunId?: string;
  lastRunId?: string;
  evidenceCount: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiskFlagEventRecord {
  id: string;
  riskFlagId: string;
  eventType: RiskFlagEventType;
  fromStatus?: RiskFlagStatus;
  toStatus?: RiskFlagStatus;
  runId?: string;
  actor?: string;
  note?: string;
  evidencePackageId?: string;
  createdAt: string;
}

export interface EvidencePackageRecord {
  id: string;
  runId: string;
  providerSlug?: string;
  riskFlagId?: string;
  redactedSummary: unknown;
  createdAt: string;
}

export interface RiskFlagEvidenceStatus {
  runId: string;
  riskFlagId: string;
  status: RiskFlagStatus;
}

export interface UpsertRiskFlagInput {
  workspaceId?: string;
  nodeId?: string;
  providerSlug?: string;
  assertionId: string;
  severity: RiskFlagSeverity;
  runId: string;
  targetModelId?: string;
  suiteId?: string;
  redactedSummary: unknown;
  observedAt?: string;
}

export interface RiskFlagRepository {
  upsertActive(input: UpsertRiskFlagInput): Promise<RiskFlagRecord>;
  transition(id: string, toStatus: RiskFlagStatus, actor?: string, note?: string): Promise<RiskFlagRecord>;
  get(id: string): Promise<RiskFlagRecord | undefined>;
  listByProvider(providerSlug: string, statuses?: RiskFlagStatus[]): Promise<RiskFlagRecord[]>;
  listEvidenceStatuses(providerSlug?: string): Promise<RiskFlagEvidenceStatus[]>;
  listEvents(id: string): Promise<RiskFlagEventRecord[]>;
  listEvidence(id: string): Promise<EvidencePackageRecord[]>;
  close(): Promise<void>;
}

export async function createRiskFlagRepository(): Promise<RiskFlagRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresRiskFlagRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteRiskFlagRepository(new DatabaseSync(config.databasePath));
}

class SqliteRiskFlagRepository implements RiskFlagRepository {
  constructor(private readonly db: { prepare(sql: string): any; close(): void }) {}

  async upsertActive(input: UpsertRiskFlagInput): Promise<RiskFlagRecord> {
    const now = input.observedAt ?? new Date().toISOString();
    const existing = this.findRecentActive(input, now);
    if (existing) {
      const evidence = this.insertEvidence(input, existing.id, now);
      this.db
        .prepare("update risk_flags set last_run_id = ?, evidence_count = evidence_count + 1, last_seen_at = ?, updated_at = ? where id = ?")
        .run(input.runId, now, now, existing.id);
      this.insertEvent(existing.id, "evidence_added", existing.status, existing.status, input.runId, evidence.id, now);
      return (await this.get(existing.id))!;
    }
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `insert into risk_flags (
          id, workspace_id, node_id, provider_slug, assertion_id, severity, status, target_model_id,
          suite_id, first_run_id, last_run_id, evidence_count, last_seen_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        id,
        input.workspaceId ?? null,
        input.nodeId ?? null,
        input.providerSlug ?? null,
        input.assertionId,
        input.severity,
        input.targetModelId ?? null,
        input.suiteId ?? null,
        input.runId,
        input.runId,
        now,
        now,
        now
      );
    const evidence = this.insertEvidence(input, id, now);
    this.insertEvent(id, "created", undefined, "active", input.runId, evidence.id, now);
    return (await this.get(id))!;
  }

  async transition(id: string, toStatus: RiskFlagStatus, actor?: string, note?: string): Promise<RiskFlagRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`Risk flag not found: ${id}`);
    assertTransition(current.status, toStatus);
    const now = new Date().toISOString();
    this.db.prepare("update risk_flags set status = ?, updated_at = ? where id = ?").run(toStatus, now, id);
    this.insertEvent(id, eventTypeFor(toStatus), current.status, toStatus, undefined, undefined, now, actor, note);
    return (await this.get(id))!;
  }

  async get(id: string): Promise<RiskFlagRecord | undefined> {
    const row = this.db.prepare("select * from risk_flags where id = ? limit 1").get(id) as RiskFlagRow | undefined;
    return row ? mapRiskFlagRow(row) : undefined;
  }

  async listByProvider(providerSlug: string, statuses: RiskFlagStatus[] = []): Promise<RiskFlagRecord[]> {
    const rows =
      statuses.length > 0
        ? this.db
            .prepare(
              `select * from risk_flags
               where provider_slug = ? and status in (${statuses.map(() => "?").join(",")})
               order by last_seen_at desc`
            )
            .all(providerSlug, ...statuses)
        : this.db.prepare("select * from risk_flags where provider_slug = ? order by last_seen_at desc").all(providerSlug);
    return (rows as RiskFlagRow[]).map(mapRiskFlagRow);
  }

  async listEvidenceStatuses(providerSlug?: string): Promise<RiskFlagEvidenceStatus[]> {
    const rows = providerSlug
      ? this.db
          .prepare(
            `select ep.run_id as runId, rf.id as riskFlagId, rf.status as status
             from evidence_packages ep
             join risk_flags rf on rf.id = ep.risk_flag_id
             where ep.provider_slug = ?`
          )
          .all(providerSlug)
      : this.db
          .prepare(
            `select ep.run_id as runId, rf.id as riskFlagId, rf.status as status
             from evidence_packages ep
             join risk_flags rf on rf.id = ep.risk_flag_id`
          )
          .all();
    return rows as RiskFlagEvidenceStatus[];
  }

  async listEvents(id: string): Promise<RiskFlagEventRecord[]> {
    const rows = this.db.prepare("select * from risk_flag_events where risk_flag_id = ? order by created_at asc").all(id) as RiskFlagEventRow[];
    return rows.map(mapEventRow);
  }

  async listEvidence(id: string): Promise<EvidencePackageRecord[]> {
    const rows = this.db.prepare("select * from evidence_packages where risk_flag_id = ? order by created_at asc").all(id) as EvidencePackageRow[];
    return rows.map(mapEvidenceRow);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private findRecentActive(input: UpsertRiskFlagInput, now: string): RiskFlagRecord | undefined {
    const cutoff = new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const row = this.db
      .prepare(
        `select * from risk_flags
         where coalesce(workspace_id, '') = coalesce(?, '')
           and coalesce(node_id, '') = coalesce(?, '')
           and coalesce(provider_slug, '') = coalesce(?, '')
           and assertion_id = ?
           and severity = ?
           and status in ('active', 'acknowledged', 'disputed', 'under_review')
           and last_seen_at >= ?
         order by last_seen_at desc limit 1`
      )
      .get(input.workspaceId ?? null, input.nodeId ?? null, input.providerSlug ?? null, input.assertionId, input.severity, cutoff) as RiskFlagRow | undefined;
    return row ? mapRiskFlagRow(row) : undefined;
  }

  private insertEvidence(input: UpsertRiskFlagInput, riskFlagId: string, now: string): EvidencePackageRecord {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `insert into evidence_packages (id, run_id, provider_slug, risk_flag_id, redacted_summary_json, created_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict(run_id) do update set risk_flag_id = excluded.risk_flag_id`
      )
      .run(id, input.runId, input.providerSlug ?? null, riskFlagId, JSON.stringify(input.redactedSummary), now);
    const row = this.db.prepare("select * from evidence_packages where run_id = ?").get(input.runId) as EvidencePackageRow;
    return mapEvidenceRow(row);
  }

  private insertEvent(
    riskFlagId: string,
    eventType: RiskFlagEventType,
    fromStatus: RiskFlagStatus | undefined,
    toStatus: RiskFlagStatus | undefined,
    runId: string | undefined,
    evidencePackageId: string | undefined,
    now: string,
    actor?: string,
    note?: string
  ) {
    this.db
      .prepare(
        `insert into risk_flag_events (
          id, risk_flag_id, event_type, from_status, to_status, run_id, actor, note, evidence_package_id, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), riskFlagId, eventType, fromStatus ?? null, toStatus ?? null, runId ?? null, actor ?? null, note ?? null, evidencePackageId ?? null, now);
  }
}

class PostgresRiskFlagRepository implements RiskFlagRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async upsertActive(input: UpsertRiskFlagInput): Promise<RiskFlagRecord> {
    const now = input.observedAt ?? new Date().toISOString();
    const existing = await this.findRecentActive(input, now);
    if (existing) {
      const evidence = await this.insertEvidence(input, existing.id, now);
      const rows = await this.sql<RiskFlagRow[]>`
        update risk_flags
        set last_run_id = ${input.runId}, evidence_count = evidence_count + 1, last_seen_at = ${now}, updated_at = ${now}
        where id = ${existing.id}
        returning *
      `;
      await this.insertEvent(existing.id, "evidence_added", existing.status, existing.status, input.runId, evidence.id, now);
      return mapRiskFlagRow(rows[0]);
    }
    const id = crypto.randomUUID();
    const rows = await this.sql<RiskFlagRow[]>`
      insert into risk_flags (
        id, workspace_id, node_id, provider_slug, assertion_id, severity, status, target_model_id,
        suite_id, first_run_id, last_run_id, evidence_count, last_seen_at, created_at, updated_at
      ) values (
        ${id}, ${input.workspaceId ?? null}, ${input.nodeId ?? null}, ${input.providerSlug ?? null},
        ${input.assertionId}, ${input.severity}, 'active', ${input.targetModelId ?? null}, ${input.suiteId ?? null},
        ${input.runId}, ${input.runId}, 1, ${now}, ${now}, ${now}
      )
      returning *
    `;
    const evidence = await this.insertEvidence(input, id, now);
    await this.insertEvent(id, "created", undefined, "active", input.runId, evidence.id, now);
    return mapRiskFlagRow(rows[0]);
  }

  async transition(id: string, toStatus: RiskFlagStatus, actor?: string, note?: string): Promise<RiskFlagRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`Risk flag not found: ${id}`);
    assertTransition(current.status, toStatus);
    const now = new Date().toISOString();
    const rows = await this.sql<RiskFlagRow[]>`
      update risk_flags set status = ${toStatus}, updated_at = ${now}
      where id = ${id}
      returning *
    `;
    await this.insertEvent(id, eventTypeFor(toStatus), current.status, toStatus, undefined, undefined, now, actor, note);
    return mapRiskFlagRow(rows[0]);
  }

  async get(id: string): Promise<RiskFlagRecord | undefined> {
    const rows = await this.sql<RiskFlagRow[]>`select * from risk_flags where id = ${id} limit 1`;
    return rows[0] ? mapRiskFlagRow(rows[0]) : undefined;
  }

  async listByProvider(providerSlug: string, statuses: RiskFlagStatus[] = []): Promise<RiskFlagRecord[]> {
    const rows =
      statuses.length > 0
        ? await this.sql<RiskFlagRow[]>`
            select * from risk_flags
            where provider_slug = ${providerSlug} and status in ${this.sql(statuses)}
            order by last_seen_at desc
          `
        : await this.sql<RiskFlagRow[]>`
            select * from risk_flags where provider_slug = ${providerSlug} order by last_seen_at desc
          `;
    return rows.map(mapRiskFlagRow);
  }

  async listEvidenceStatuses(providerSlug?: string): Promise<RiskFlagEvidenceStatus[]> {
    const rows = providerSlug
      ? await this.sql<RiskFlagEvidenceStatus[]>`
          select ep.run_id as "runId", rf.id as "riskFlagId", rf.status as status
          from evidence_packages ep
          join risk_flags rf on rf.id = ep.risk_flag_id
          where ep.provider_slug = ${providerSlug}
        `
      : await this.sql<RiskFlagEvidenceStatus[]>`
          select ep.run_id as "runId", rf.id as "riskFlagId", rf.status as status
          from evidence_packages ep
          join risk_flags rf on rf.id = ep.risk_flag_id
        `;
    return rows;
  }

  async listEvents(id: string): Promise<RiskFlagEventRecord[]> {
    const rows = await this.sql<RiskFlagEventRow[]>`
      select * from risk_flag_events where risk_flag_id = ${id} order by created_at asc
    `;
    return rows.map(mapEventRow);
  }

  async listEvidence(id: string): Promise<EvidencePackageRecord[]> {
    const rows = await this.sql<EvidencePackageRow[]>`
      select * from evidence_packages where risk_flag_id = ${id} order by created_at asc
    `;
    return rows.map(mapEvidenceRow);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private async findRecentActive(input: UpsertRiskFlagInput, now: string): Promise<RiskFlagRecord | undefined> {
    const cutoff = new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.sql<RiskFlagRow[]>`
      select * from risk_flags
      where coalesce(workspace_id, '') = coalesce(${input.workspaceId ?? null}, '')
        and coalesce(node_id, '') = coalesce(${input.nodeId ?? null}, '')
        and coalesce(provider_slug, '') = coalesce(${input.providerSlug ?? null}, '')
        and assertion_id = ${input.assertionId}
        and severity = ${input.severity}
        and status in ('active', 'acknowledged', 'disputed', 'under_review')
        and last_seen_at >= ${cutoff}
      order by last_seen_at desc limit 1
    `;
    return rows[0] ? mapRiskFlagRow(rows[0]) : undefined;
  }

  private async insertEvidence(input: UpsertRiskFlagInput, riskFlagId: string, now: string): Promise<EvidencePackageRecord> {
    const rows = await this.sql<EvidencePackageRow[]>`
      insert into evidence_packages (id, run_id, provider_slug, risk_flag_id, redacted_summary_json, created_at)
      values (${crypto.randomUUID()}, ${input.runId}, ${input.providerSlug ?? null}, ${riskFlagId}, ${this.sql.json(input.redactedSummary as any)}, ${now})
      on conflict (run_id) do update set risk_flag_id = excluded.risk_flag_id
      returning *
    `;
    return mapEvidenceRow(rows[0]);
  }

  private async insertEvent(
    riskFlagId: string,
    eventType: RiskFlagEventType,
    fromStatus: RiskFlagStatus | undefined,
    toStatus: RiskFlagStatus | undefined,
    runId: string | undefined,
    evidencePackageId: string | undefined,
    now: string,
    actor?: string,
    note?: string
  ) {
    await this.sql`
      insert into risk_flag_events (
        id, risk_flag_id, event_type, from_status, to_status, run_id, actor, note, evidence_package_id, created_at
      ) values (
        ${crypto.randomUUID()}, ${riskFlagId}, ${eventType}, ${fromStatus ?? null}, ${toStatus ?? null},
        ${runId ?? null}, ${actor ?? null}, ${note ?? null}, ${evidencePackageId ?? null}, ${now}
      )
    `;
  }
}

interface RiskFlagRow {
  id: string;
  workspace_id?: string | null;
  node_id?: string | null;
  provider_slug?: string | null;
  assertion_id: string;
  severity: RiskFlagSeverity;
  status: RiskFlagStatus;
  target_model_id?: string | null;
  suite_id?: string | null;
  first_run_id?: string | null;
  last_run_id?: string | null;
  evidence_count: number;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

interface RiskFlagEventRow {
  id: string;
  risk_flag_id: string;
  event_type: RiskFlagEventType;
  from_status?: RiskFlagStatus | null;
  to_status?: RiskFlagStatus | null;
  run_id?: string | null;
  actor?: string | null;
  note?: string | null;
  evidence_package_id?: string | null;
  created_at: string;
}

interface EvidencePackageRow {
  id: string;
  run_id: string;
  provider_slug?: string | null;
  risk_flag_id?: string | null;
  redacted_summary_json: string | object;
  created_at: string;
}

function assertTransition(from: RiskFlagStatus, to: RiskFlagStatus) {
  const allowed: Record<RiskFlagStatus, RiskFlagStatus[]> = {
    active: ["acknowledged", "disputed", "resolved"],
    acknowledged: ["resolved"],
    disputed: ["under_review"],
    under_review: ["resolved", "upheld"],
    upheld: ["resolved"],
    resolved: []
  };
  if (!allowed[from].includes(to)) throw new Error(`Invalid risk flag transition: ${from} -> ${to}`);
}

function eventTypeFor(status: RiskFlagStatus): RiskFlagEventType {
  if (status === "active") return "created";
  return status === "under_review" ? "under_review" : status;
}

function mapRiskFlagRow(row: RiskFlagRow): RiskFlagRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    nodeId: row.node_id ?? undefined,
    providerSlug: row.provider_slug ?? undefined,
    assertionId: row.assertion_id,
    severity: row.severity,
    status: row.status,
    targetModelId: row.target_model_id ?? undefined,
    suiteId: row.suite_id ?? undefined,
    firstRunId: row.first_run_id ?? undefined,
    lastRunId: row.last_run_id ?? undefined,
    evidenceCount: row.evidence_count,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEventRow(row: RiskFlagEventRow): RiskFlagEventRecord {
  return {
    id: row.id,
    riskFlagId: row.risk_flag_id,
    eventType: row.event_type,
    fromStatus: row.from_status ?? undefined,
    toStatus: row.to_status ?? undefined,
    runId: row.run_id ?? undefined,
    actor: row.actor ?? undefined,
    note: row.note ?? undefined,
    evidencePackageId: row.evidence_package_id ?? undefined,
    createdAt: row.created_at
  };
}

function mapEvidenceRow(row: EvidencePackageRow): EvidencePackageRecord {
  return {
    id: row.id,
    runId: row.run_id,
    providerSlug: row.provider_slug ?? undefined,
    riskFlagId: row.risk_flag_id ?? undefined,
    redactedSummary: typeof row.redacted_summary_json === "string" ? JSON.parse(row.redacted_summary_json) : row.redacted_summary_json,
    createdAt: row.created_at
  };
}
