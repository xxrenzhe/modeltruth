import type { AuditRunListItem } from "./audit-runs";
import { normalizePublicUsage } from "./public-usage";

export interface PublicAuditSummary {
  totalRuns: number;
  passRate: number;
  errorRate: number;
  p50TtftMs?: number;
  p95TtftMs?: number;
  evidenceScore: number;
  lastRunAt?: string;
  dataFreshnessSeconds?: number;
  isFresh: boolean;
  windows: Record<AuditWindowKey, PublicAuditWindow>;
  providers: ProviderAuditSummary[];
  riskFlags: PublicRiskFlag[];
}

export type AuditWindowKey = "24h" | "7d" | "30d";

export interface PublicAuditWindow {
  window: AuditWindowKey;
  totalRuns: number;
  uptime: number;
  passRate: number;
  errorRate: number;
  p50TtftMs?: number;
  p95TtftMs?: number;
  evidenceScore: number;
}

export interface ProviderAuditSummary {
  providerSlug: string;
  windows: Record<AuditWindowKey, PublicAuditWindow>;
  riskFlags: PublicRiskFlag[];
  evidenceScore: number;
  lastRunAt?: string;
  dataFreshnessSeconds?: number;
  isFresh: boolean;
}

export interface PublicRiskFlag {
  riskFlagId?: string;
  riskFlagStatus?: string;
  runId: string;
  providerSlug?: string;
  suiteId: string;
  runType: string;
  targetModelId: string;
  status: string;
  confidence?: number;
  metrics: unknown;
  assertions: unknown;
  evidenceSummary: unknown;
  createdAt: string;
}

export function buildPublicAuditSummary(allRuns: AuditRunListItem[], providerSlug?: string, riskFlagStatuses = new Map<string, { riskFlagId: string; status: string }>()): PublicAuditSummary {
  const runs = providerSlug ? allRuns.filter((run) => run.providerSlug === providerSlug) : allRuns;
  const aggregate = aggregateRuns(runs, "30d");
  const freshness = dashboardFreshness(runs);
  return {
    totalRuns: aggregate.totalRuns,
    passRate: aggregate.passRate,
    errorRate: aggregate.errorRate,
    p50TtftMs: aggregate.p50TtftMs,
    p95TtftMs: aggregate.p95TtftMs,
    evidenceScore: aggregate.evidenceScore,
    ...freshness,
    windows: buildWindows(runs),
    providers: buildProviderSummaries(allRuns, riskFlagStatuses),
    riskFlags: publicRiskFlags(runs, riskFlagStatuses).slice(0, 10).map((run) => toPublicRiskFlag(run, riskFlagStatuses))
  };
}

function buildProviderSummaries(runs: AuditRunListItem[], riskFlagStatuses: Map<string, { riskFlagId: string; status: string }>): ProviderAuditSummary[] {
  const providerSlugs = [...new Set(runs.map((run) => run.providerSlug).filter((slug): slug is string => Boolean(slug)))].sort();
  return providerSlugs.map((providerSlug) => {
    const providerRuns = runs.filter((run) => run.providerSlug === providerSlug);
    return {
      providerSlug,
      windows: buildWindows(providerRuns),
      riskFlags: publicRiskFlags(providerRuns, riskFlagStatuses).slice(0, 5).map((run) => toPublicRiskFlag(run, riskFlagStatuses)),
      evidenceScore: aggregateRuns(providerRuns, "30d").evidenceScore,
      ...dashboardFreshness(providerRuns)
    };
  });
}

function dashboardFreshness(runs: AuditRunListItem[]) {
  const latest = runs
    .map((run) => new Date(run.createdAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0];
  if (latest === undefined) return { isFresh: false };
  const dataFreshnessSeconds = Math.max(0, Math.floor((Date.now() - latest) / 1000));
  return {
    lastRunAt: new Date(latest).toISOString(),
    dataFreshnessSeconds,
    isFresh: dataFreshnessSeconds <= 10 * 60
  };
}

function buildWindows(runs: AuditRunListItem[]): Record<AuditWindowKey, PublicAuditWindow> {
  return {
    "24h": aggregateRuns(filterSince(runs, 24 * 60 * 60 * 1000), "24h"),
    "7d": aggregateRuns(filterSince(runs, 7 * 24 * 60 * 60 * 1000), "7d"),
    "30d": aggregateRuns(filterSince(runs, 30 * 24 * 60 * 60 * 1000), "30d")
  };
}

function filterSince(runs: AuditRunListItem[], windowMs: number) {
  const cutoff = Date.now() - windowMs;
  return runs.filter((run) => new Date(run.createdAt).getTime() >= cutoff);
}

function aggregateRuns(runs: AuditRunListItem[], window: AuditWindowKey): PublicAuditWindow {
  const totalRuns = runs.length;
  const passCount = runs.filter((run) => run.status === "pass").length;
  const errorCount = riskRuns(runs).length;
  const ttfts = runs
    .map((run) => metricNumber(run.metrics, "ttftMs"))
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  const errorRate = totalRuns ? errorCount / totalRuns : 0;
  return {
    window,
    totalRuns,
    uptime: totalRuns ? 1 - errorRate : 0,
    passRate: totalRuns ? passCount / totalRuns : 0,
    errorRate,
    p50TtftMs: percentile(ttfts, 0.5),
    p95TtftMs: percentile(ttfts, 0.95),
    evidenceScore: evidenceScore(runs, totalRuns, errorRate)
  };
}

function evidenceScore(runs: AuditRunListItem[], totalRuns: number, errorRate: number) {
  if (!totalRuns) return 0;
  const confidence = runs.reduce((sum, run) => sum + (run.confidence ?? 0), 0) / totalRuns;
  const coverage = Math.min(totalRuns / 20, 1);
  return Math.round(Math.max(0, Math.min(1, coverage * 0.4 + confidence * 0.4 + (1 - errorRate) * 0.2)) * 100);
}

function riskRuns(runs: AuditRunListItem[]) {
  return runs.filter((run) => ["fail", "error", "warning"].includes(run.status));
}

function publicRiskFlags(runs: AuditRunListItem[], riskFlagStatuses: Map<string, { riskFlagId: string; status: string }>) {
  const groups = new Map<string, AuditRunListItem[]>();
  for (const run of runs) {
    const group = groups.get(riskGroupKey(run)) ?? [];
    group.push(run);
    groups.set(riskGroupKey(run), group);
  }
  return riskRuns(runs).filter((run) => {
    const persisted = riskFlagStatuses.get(run.runId);
    if (persisted?.status === "resolved") return false;
    const group = groups.get(riskGroupKey(run)) ?? [];
    const confirmingRiskRuns = riskRuns(group);
    const hasConfirmingRiskRetest = confirmingRiskRuns.some((candidate) => candidate.runId !== run.runId);
    return confirmingRiskRuns.length >= 2 || ((run.confidence ?? 0) >= 0.85 && hasConfirmingRiskRetest);
  });
}

function riskGroupKey(run: AuditRunListItem) {
  return [run.providerSlug ?? "unknown-provider", run.targetModelId, run.suiteId].join(":");
}

function toPublicRiskFlag(run: AuditRunListItem, riskFlagStatuses: Map<string, { riskFlagId: string; status: string }>): PublicRiskFlag {
  const persisted = riskFlagStatuses.get(run.runId);
  return {
    riskFlagId: persisted?.riskFlagId,
    riskFlagStatus: persisted?.status,
    runId: run.runId,
    providerSlug: run.providerSlug,
    suiteId: run.suiteId,
    runType: run.runType,
    targetModelId: run.targetModelId,
    status: run.status,
    confidence: run.confidence,
    metrics: run.metrics,
    assertions: publicAssertionSummary(run.assertions),
    evidenceSummary: publicEvidenceSummary(run.evidenceSummary),
    createdAt: run.createdAt
  };
}

function publicAssertionSummary(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((assertion) => {
    const record = assertion && typeof assertion === "object" && !Array.isArray(assertion) ? (assertion as Record<string, unknown>) : {};
    return pickPublic(record, ["id", "status", "confidence", "message"]);
  });
}

function publicEvidenceSummary(value: unknown) {
  const summary = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return stripUndefined({
    redaction: stringValue(summary.redaction),
    requestBodyStored: booleanValue(summary.requestBodyStored),
    responseBodyStored: booleanValue(summary.responseBodyStored),
    targetHostHash: stringValue(summary.targetHostHash),
    completionHash: stringValue(summary.completionHash),
    usage: publicUsage(summary.usage),
    billingVariance: publicBillingVariance(summary.billingVariance),
    suiteId: stringValue(summary.suiteId),
    suiteVersion: stringValue(summary.suiteVersion),
    promptNonceHash: stringValue(summary.promptNonceHash),
    numericNonceHash: stringValue(summary.numericNonceHash),
    timestampBucket: stringValue(summary.timestampBucket),
    retestRecommendation: stringValue(summary.retestRecommendation),
    requestMetadata: publicRequestMetadata(summary.requestMetadata),
    responseMetadata: publicResponseMetadata(summary.responseMetadata),
    latencyTimeline: publicLatencyTimeline(summary.latencyTimeline),
    promptDiffSummary: publicPromptDiffSummary(summary.promptDiffSummary),
    responseExcerptPolicy: stringValue(summary.responseExcerptPolicy),
    fullResponseStored: booleanValue(summary.fullResponseStored),
    fullResponsePolicy: stringValue(summary.fullResponsePolicy),
    finishReason: stringValue(summary.finishReason),
    errorCode: stringValue(summary.errorCode),
    errorType: stringValue(summary.errorType),
    traceparent: stringValue(summary.traceparent),
    openInference: publicOpenInference(summary.openInference),
    modelRegistry: publicModelRegistry(summary.modelRegistry),
    externalProbe: booleanValue(summary.externalProbe),
    probeRegion: stringValue(summary.probeRegion)
  });
}

function pickPublic(record: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]]));
}

function publicUsage(value: unknown) {
  return normalizePublicUsage(value);
}

function publicBillingVariance(value: unknown) {
  return pickRecord(value, ["expectedCostUsd", "actualCostUsd", "varianceRatio", "direction", "status", "retestRequired"]);
}

function publicRequestMetadata(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  return stripUndefined({
    method: stringValue(record.method),
    targetHostHash: stringValue(record.targetHostHash),
    model: stringValue(record.model),
    headers: publicHeaderList(record.headers)
  });
}

function publicResponseMetadata(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  return stripUndefined({
    status: numberValue(record.status),
    headers: publicHeaders(record.headers),
    usage: publicUsage(record.usage),
    finishReason: stringValue(record.finishReason),
    errorCode: stringValue(record.errorCode),
    errorType: stringValue(record.errorType)
  });
}

function publicLatencyTimeline(value: unknown) {
  return pickRecord(value, ["requestStartOffsetMs", "ttftMs", "totalLatencyMs", "dnsMs", "connectMs", "ttfbMs"]);
}

function publicPromptDiffSummary(value: unknown) {
  return pickRecord(value, ["promptHashOnly", "promptHash", "suiteId", "promptLength"]);
}

function publicOpenInference(value: unknown) {
  return pickRecord(value, [
    "openinference.span.kind",
    "llm.provider",
    "llm.model_name",
    "llm.system",
    "llm.invocation_parameters.max_tokens",
    "llm.token_count.completion",
    "modeltruth.suite_id",
    "modeltruth.suite_version",
    "modeltruth.provider_host_hash"
  ]);
}

function publicModelRegistry(value: unknown) {
  return pickRecord(value, ["provider", "modelId", "status", "baselineSuiteVersion", "lastCalibratedAt"]);
}

function pickRecord(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return undefined;
  return stripUndefined(Object.fromEntries(keys.map((key) => [key, scalarValue(record[key])])));
}

function publicHeaderList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const safe = value.filter((item): item is string => typeof item === "string" && isPublicHeaderName(item.split(":")[0] ?? ""));
  return safe.length ? safe : undefined;
}

function publicHeaders(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  return stripUndefined(Object.fromEntries(Object.entries(record).filter(([key]) => isPublicHeaderName(key)).map(([key, entry]) => [key.toLowerCase(), stringValue(entry)])));
}

function isPublicHeaderName(key: string) {
  const normalized = key.trim().toLowerCase();
  return ["content-type", "request-id", "x-request-id", "x-usage", "x-provider-usage"].includes(normalized) || normalized.startsWith("rate-limit-") || normalized.startsWith("x-ratelimit-");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function scalarValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(record: T) {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function metricNumber(metrics: unknown, key: string): number | undefined {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return undefined;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}
