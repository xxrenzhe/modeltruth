import postgres from "postgres";
import { getAppConfig } from "@modeltruth/config";
import { safeErrorMessage } from "@modeltruth/shared";

export type JobType =
  | "heartbeat"
  | "deepAudit"
  | "alert"
  | "calibration"
  | "disputeReview"
  | "prioritySupport"
  | "providerDigest";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  payloadJson: string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt?: string;
  lockedBy?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  type: JobType;
  payload: unknown;
  runAfter?: Date;
  maxAttempts?: number;
}

export interface ClaimJobInput {
  workerId: string;
  types?: JobType[];
  now?: Date;
  leaseTimeoutMs?: number;
}

export interface JobRepository {
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  claimNext(input: ClaimJobInput): Promise<JobRecord | undefined>;
  hasActiveFingerprint(type: JobType, fingerprint: string): Promise<boolean>;
  hasRecentFingerprint(type: JobType, fingerprint: string, since: Date): Promise<boolean>;
  heartbeat(id: string, workerId: string, now?: Date): Promise<boolean>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, nextRunAfter?: Date): Promise<void>;
  close(): Promise<void>;
}

export async function createJobRepository(): Promise<JobRepository> {
  const config = getAppConfig();
  if (config.databaseUrl) return new PostgresJobRepository(config.databaseUrl);
  const { DatabaseSync } = await import("node:sqlite");
  return new SqliteJobRepository(new DatabaseSync(config.databasePath));
}

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: { prepare(sql: string): any; exec(sql: string): void; close(): void }) {
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();
    const record = buildQueuedJob(input, now);
    this.db
      .prepare(
        `insert into jobs (id, type, status, payload_json, attempts, max_attempts, run_after, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.type,
        record.status,
        record.payloadJson,
        record.attempts,
        record.maxAttempts,
        record.runAfter,
        record.createdAt,
        record.updatedAt
      );
    return record;
  }

  async claimNext(input: ClaimJobInput): Promise<JobRecord | undefined> {
    const now = (input.now ?? new Date()).toISOString();
    const staleBefore = new Date(
      (input.now ?? new Date()).getTime() - resolveLeaseTimeoutMs(input.leaseTimeoutMs)
    ).toISOString();
    const typeFilter = input.types?.length ? `and type in (${input.types.map(() => "?").join(",")})` : "";
    const params = input.types?.length ? [now, staleBefore, ...input.types] : [now, staleBefore];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `update jobs
           set status = 'failed',
               last_error = 'job lease expired after max attempts',
               updated_at = ?
           where status = 'running'
             and locked_at is not null
             and locked_at <= ?
             and attempts >= max_attempts`
        )
        .run(now, staleBefore);
      const row = this.db
        .prepare(
          `select * from jobs
           where attempts < max_attempts
             and (
               (status = 'queued' and run_after <= ?)
               or (status = 'running' and locked_at is not null and locked_at <= ?)
             )
             ${typeFilter}
           order by run_after asc, created_at asc
           limit 1`
        )
        .get(...params) as JobRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db
        .prepare(
          `update jobs
           set status = 'running', attempts = attempts + 1, locked_at = ?, locked_by = ?, updated_at = ?
           where id = ?`
        )
        .run(now, input.workerId, now, row.id);
      this.db.exec("COMMIT");
      return mapJobRow({ ...row, status: "running", attempts: row.attempts + 1, locked_at: now, locked_by: input.workerId, updated_at: now });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async hasActiveFingerprint(type: JobType, fingerprint: string): Promise<boolean> {
    const row = this.db
      .prepare(
        `select id from jobs
         where type = ?
           and status in ('queued', 'running')
           and json_extract(payload_json, '$.fingerprint') = ?
         limit 1`
      )
      .get(type, fingerprint) as { id: string } | undefined;
    return Boolean(row);
  }

  async hasRecentFingerprint(type: JobType, fingerprint: string, since: Date): Promise<boolean> {
    const row = this.db
      .prepare(
        `select id from jobs
         where type = ?
           and created_at >= ?
           and json_extract(payload_json, '$.fingerprint') = ?
         limit 1`
      )
      .get(type, since.toISOString(), fingerprint) as { id: string } | undefined;
    return Boolean(row);
  }

  async heartbeat(id: string, workerId: string, now = new Date()): Promise<boolean> {
    const result = this.db
      .prepare("update jobs set locked_at = ?, updated_at = ? where id = ? and status = 'running' and locked_by = ?")
      .run(now.toISOString(), now.toISOString(), id, workerId) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  async complete(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare("update jobs set status = 'completed', locked_at = null, locked_by = null, updated_at = ? where id = ?")
      .run(now, id);
  }

  async fail(id: string, error: string, nextRunAfter?: Date): Promise<void> {
    const now = new Date().toISOString();
    const row = this.db.prepare("select attempts, max_attempts from jobs where id = ?").get(id) as
      | { attempts: number; max_attempts: number }
      | undefined;
    const status = row && row.attempts >= row.max_attempts ? "failed" : "queued";
    const runAfter = nextRunAfter ?? resolveRetryAfter(row?.attempts ?? 1);
    this.db
      .prepare(
        "update jobs set status = ?, locked_at = null, locked_by = null, last_error = ?, run_after = ?, updated_at = ? where id = ?"
      )
      .run(status, safeJobError(error), runAfter.toISOString(), now, id);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresJobRepository implements JobRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 1 });
  }

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();
    const record = buildQueuedJob(input, now);
    await this.sql`
      insert into jobs (id, type, status, payload_json, attempts, max_attempts, run_after, created_at, updated_at)
      values (${record.id}, ${record.type}, ${record.status}, ${record.payloadJson}, ${record.attempts},
        ${record.maxAttempts}, ${record.runAfter}, ${record.createdAt}, ${record.updatedAt})
    `;
    return record;
  }

  async claimNext(input: ClaimJobInput): Promise<JobRecord | undefined> {
    const now = (input.now ?? new Date()).toISOString();
    const staleBefore = new Date(
      (input.now ?? new Date()).getTime() - resolveLeaseTimeoutMs(input.leaseTimeoutMs)
    ).toISOString();
    const rows = await this.sql.begin(async (tx) => {
      await tx`
        update jobs
        set status = 'failed',
            last_error = 'job lease expired after max attempts',
            updated_at = ${now}
        where status = 'running'
          and locked_at is not null
          and locked_at <= ${staleBefore}
          and attempts >= max_attempts
      `;
      const selected = input.types?.length
        ? await tx`
            select * from jobs
            where attempts < max_attempts
              and ((status = 'queued' and run_after <= ${now}) or (status = 'running' and locked_at is not null and locked_at <= ${staleBefore}))
              and type in ${tx(input.types)}
            order by run_after asc, created_at asc
            for update skip locked
            limit 1
          `
        : await tx`
            select * from jobs
            where attempts < max_attempts
              and ((status = 'queued' and run_after <= ${now}) or (status = 'running' and locked_at is not null and locked_at <= ${staleBefore}))
            order by run_after asc, created_at asc
            for update skip locked
            limit 1
          `;
      if (!selected[0]) return [];
      return tx`
        update jobs
        set status = 'running', attempts = attempts + 1, locked_at = ${now}, locked_by = ${input.workerId}, updated_at = ${now}
        where id = ${selected[0].id}
        returning *
      `;
    });
    return rows[0] ? mapJobRow(rows[0] as JobRow) : undefined;
  }

  async hasActiveFingerprint(type: JobType, fingerprint: string): Promise<boolean> {
    const rows = await this.sql`
      select id from jobs
      where type = ${type}
        and status in ('queued', 'running')
        and payload_json::jsonb ->> 'fingerprint' = ${fingerprint}
      limit 1
    `;
    return rows.length > 0;
  }

  async hasRecentFingerprint(type: JobType, fingerprint: string, since: Date): Promise<boolean> {
    const rows = await this.sql`
      select id from jobs
      where type = ${type}
        and created_at >= ${since.toISOString()}
        and payload_json::jsonb ->> 'fingerprint' = ${fingerprint}
      limit 1
    `;
    return rows.length > 0;
  }

  async heartbeat(id: string, workerId: string, now = new Date()): Promise<boolean> {
    const rows = await this.sql`
      update jobs
      set locked_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
      where id = ${id} and status = 'running' and locked_by = ${workerId}
      returning id
    `;
    return rows.length > 0;
  }

  async complete(id: string): Promise<void> {
    await this.sql`
      update jobs
      set status = 'completed', locked_at = null, locked_by = null, updated_at = ${new Date().toISOString()}
      where id = ${id}
    `;
  }

  async fail(id: string, error: string, nextRunAfter?: Date): Promise<void> {
    const rows = await this.sql<{ attempts: number }[]>`select attempts from jobs where id = ${id} limit 1`;
    const runAfter = nextRunAfter ?? resolveRetryAfter(rows[0]?.attempts ?? 1);
    await this.sql`
      update jobs
      set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
          locked_at = null,
          locked_by = null,
          last_error = ${safeJobError(error)},
          run_after = ${runAfter.toISOString()},
          updated_at = ${new Date().toISOString()}
      where id = ${id}
    `;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at?: string;
  locked_by?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

function buildQueuedJob(input: EnqueueJobInput, now: string): JobRecord {
  return {
    id: crypto.randomUUID(),
    type: input.type,
    status: "queued",
    payloadJson: JSON.stringify(input.payload),
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    runAfter: (input.runAfter ?? new Date()).toISOString(),
    createdAt: now,
    updatedAt: now
  };
}

export function resolveRetryDelayMs(attempts: number) {
  const delays = [10_000, 60_000, 300_000];
  return delays[Math.min(Math.max(attempts, 1), delays.length) - 1];
}

function resolveRetryAfter(attempts: number) {
  return new Date(Date.now() + resolveRetryDelayMs(attempts));
}

function resolveLeaseTimeoutMs(value?: number) {
  const candidate = value ?? Number(process.env.JOB_LEASE_TIMEOUT_MS ?? 300_000);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 300_000;
}

function safeJobError(error: string) {
  return safeErrorMessage(error, "job failed").slice(0, 1000);
}

function mapJobRow(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payloadJson: row.payload_json,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
