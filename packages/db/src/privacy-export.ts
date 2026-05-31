import postgres from "postgres";
import type { AuthUser, AuthWorkspace, PrivacyExport, WorkspaceMembershipExport } from "./auth";
import { listAuditRuns } from "./audit-runs";
import { createAlertChannelRepository } from "./alert-channels";
import { createProviderNodeRepository } from "./provider-nodes";
import { createProviderSubscriptionRepository } from "./provider-subscriptions";
import { normalizePublicUsage } from "./public-usage";

export async function buildPrivacyExport(input: { user: AuthUser; databaseUrl?: string }): Promise<PrivacyExport> {
  const workspaces = input.databaseUrl
    ? await postgresWorkspaces(input.databaseUrl, input.user.id)
    : await sqliteWorkspaces(input.user.id);
  const workspaceMemberships = input.databaseUrl
    ? await postgresMemberships(input.databaseUrl, input.user)
    : await sqliteMemberships(input.user);
  const workspaceIds = [...new Set([...workspaces.map((item) => item.id), ...workspaceMemberships.map((item) => item.id)])];
  const providerNodes = (await Promise.all(workspaceIds.map(listWorkspaceNodes))).flat();
  const alertChannels = (await Promise.all(workspaceIds.map(listWorkspaceAlertChannels))).flat();
  const providerSubscriptions = await listProviderSubscriptions(input.user.email);
  const auditRuns = (await Promise.all(workspaceIds.map((workspaceId) => listAuditRuns({ workspaceId, limit: 500 })))).flat().map((run) => ({
    ...run,
    assertions: sanitizeAssertions(run.assertions),
    evidenceSummary: sanitizeEvidenceSummary(run.evidenceSummary)
  }));
  return { user: input.user, workspaces, workspaceMemberships, providerNodes, alertChannels, providerSubscriptions, auditRuns };
}

async function sqliteWorkspaces(userId: string) {
  const { getAppConfig } = await import("@modeltruth/config");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(getAppConfig().databasePath);
  try {
    return db.prepare("select id, name, tier from workspaces where owner_id = ? order by created_at asc").all(userId) as unknown as AuthWorkspace[];
  } finally {
    db.close();
  }
}

async function sqliteMemberships(user: AuthUser) {
  const { getAppConfig } = await import("@modeltruth/config");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(getAppConfig().databasePath);
  try {
    return db.prepare(membershipSql("?", "?")).all(user.id, user.email) as unknown as WorkspaceMembershipExport[];
  } finally {
    db.close();
  }
}

async function postgresWorkspaces(databaseUrl: string, userId: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await sql<AuthWorkspace[]>`select id, name, tier from workspaces where owner_id = ${userId} order by created_at asc`;
  } finally {
    await sql.end();
  }
}

async function postgresMemberships(databaseUrl: string, user: AuthUser) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await sql<WorkspaceMembershipExport[]>`
      select w.id, w.name, w.tier, wm.role, wm.status
      from workspace_members wm
      join workspaces w on w.id = wm.workspace_id
      where wm.user_id = ${user.id} or wm.email = ${user.email}
      order by wm.invited_at asc
    `;
  } finally {
    await sql.end();
  }
}

async function listWorkspaceNodes(workspaceId: string) {
  const repo = await createProviderNodeRepository();
  try {
    return await repo.list(workspaceId);
  } finally {
    await repo.close();
  }
}

async function listWorkspaceAlertChannels(workspaceId: string) {
  const repo = await createAlertChannelRepository();
  try {
    return await repo.list(workspaceId);
  } finally {
    await repo.close();
  }
}

async function listProviderSubscriptions(email: string) {
  const repo = await createProviderSubscriptionRepository();
  try {
    return await repo.listByEmail(email);
  } finally {
    await repo.close();
  }
}

function membershipSql(userPlaceholder: string, emailPlaceholder: string) {
  return `select w.id, w.name, w.tier, wm.role, wm.status
    from workspace_members wm
    join workspaces w on w.id = wm.workspace_id
    where wm.user_id = ${userPlaceholder} or wm.email = ${emailPlaceholder}
    order by wm.invited_at asc`;
}

function sanitizeAssertions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((assertion) => {
    const record = assertion && typeof assertion === "object" && !Array.isArray(assertion) ? (assertion as Record<string, unknown>) : {};
    return pick(record, ["id", "status", "confidence", "message"]);
  });
}

function sanitizeEvidenceSummary(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const summary = pick(record, [
    "redaction",
    "requestBodyStored",
    "responseBodyStored",
    "targetHostHash",
    "completionHash",
    "usage",
    "billingVariance",
    "suiteId",
    "suiteVersion",
    "promptNonceHash",
    "numericNonceHash",
    "timestampBucket",
    "retestRecommendation",
    "requestMetadata",
    "responseMetadata",
    "latencyTimeline",
    "promptDiffSummary",
    "responseExcerptPolicy",
    "fullResponseStored",
    "fullResponsePolicy",
    "finishReason",
    "errorCode",
    "errorType",
    "traceparent"
  ]);
  if (summary.usage) summary.usage = normalizePublicUsage(summary.usage);
  if (summary.responseMetadata) {
    const responseMetadata = pick(asRecord(summary.responseMetadata), ["status", "headers", "usage", "finishReason", "errorCode", "errorType"]);
    if (responseMetadata.usage) responseMetadata.usage = normalizePublicUsage(responseMetadata.usage);
    summary.responseMetadata = responseMetadata;
  }
  return summary;
}

function pick(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
