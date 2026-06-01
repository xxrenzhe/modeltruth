import { createProviderUnsubscribeToken, decryptSecret } from "@modeltruth/crypto";
import { createAlertChannelRepository, createJobRepository, ensureDatabaseReady } from "@modeltruth/db";
import { installGracefulShutdown, redactLogValue, writeJsonLog } from "@modeltruth/shared";

const intervalMs = Number(process.env.NOTIFIER_POLL_INTERVAL_MS ?? 5000);
const workerId = `notifier-${process.pid}`;

export async function runNotifierTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.claimNext({ workerId, types: ["alert", "providerDigest"] });
    if (!job) return;
    try {
      const delivered =
        job.type === "providerDigest"
          ? await deliverProviderDigest(parseProviderDigestPayload(job.payloadJson))
          : await deliverAlert(parseAlertPayload(job.payloadJson));
      writeJsonLog({
        service: "notifier",
        event: job.type === "providerDigest" ? "provider_digest.delivered" : "alert.delivered",
        data: { jobId: job.id, deliveredChannels: delivered }
      });
      await repo.complete(job.id);
    } catch (error) {
      await repo.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  } finally {
    await repo.close();
  }
}

export interface ProviderDigestPayload {
  providerSlug: string;
  providerName?: string;
  notificationType: "risk_trend" | "weekly_digest";
  subscriberEmails: string[];
  status?: string;
  uptime?: number;
  p95TtftMs?: number;
  auditPassRate?: number;
  riskFlagCount?: number;
  evidenceScore?: number;
  scheduledAt?: string;
}

export interface AlertPayload {
  workspaceId: string;
  nodeId?: string;
  runId?: string;
  status: string;
  confidence?: number;
  message: string;
  rule?: string;
  createdAt?: string;
}

export async function deliverAlert(payload: AlertPayload, fetchImpl = fetch): Promise<number> {
  const channels = await createAlertChannelRepository();
  try {
    const enabled = await channels.listEnabledSecrets(payload.workspaceId);
    let delivered = 0;
    for (const channel of enabled) {
      const target = decryptSecret(channel.encryptedTarget);
      await postAlert(target, channel.type, payload, fetchImpl);
      delivered += 1;
    }
    return delivered;
  } finally {
    await channels.close();
  }
}

export async function deliverProviderDigest(payload: ProviderDigestPayload, fetchImpl = fetch): Promise<number> {
  const destination = emailWebhookUrl();
  let delivered = 0;
  for (const email of payload.subscriberEmails) {
    const response = await fetchImpl(destination, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatProviderDigestBody(payload, email))
    });
    if (!response.ok) throw new Error(`provider digest delivery failed with ${response.status}`);
    delivered += 1;
  }
  return delivered;
}

function parseAlertPayload(payloadJson: string): AlertPayload {
  const payload = JSON.parse(payloadJson) as Partial<AlertPayload>;
  if (!payload.workspaceId || !payload.status || !payload.message) {
    throw new Error("alert payload requires workspaceId, status and message");
  }
  return {
    workspaceId: payload.workspaceId,
    nodeId: payload.nodeId,
    runId: payload.runId,
    status: payload.status,
    confidence: payload.confidence,
    message: payload.message,
    rule: payload.rule,
    createdAt: payload.createdAt
  };
}

function parseProviderDigestPayload(payloadJson: string): ProviderDigestPayload {
  const payload = JSON.parse(payloadJson) as Partial<ProviderDigestPayload>;
  if (!payload.providerSlug || !payload.notificationType || !Array.isArray(payload.subscriberEmails)) {
    throw new Error("provider digest payload requires providerSlug, notificationType and subscriberEmails");
  }
  if (payload.notificationType !== "risk_trend" && payload.notificationType !== "weekly_digest") {
    throw new Error("provider digest notificationType is invalid");
  }
  return {
    providerSlug: payload.providerSlug,
    providerName: payload.providerName,
    notificationType: payload.notificationType,
    subscriberEmails: payload.subscriberEmails.filter((email): email is string => typeof email === "string" && email.includes("@")),
    status: payload.status,
    uptime: payload.uptime,
    p95TtftMs: payload.p95TtftMs,
    auditPassRate: payload.auditPassRate,
    riskFlagCount: payload.riskFlagCount,
    evidenceScore: payload.evidenceScore,
    scheduledAt: payload.scheduledAt
  };
}

async function postAlert(target: string, type: string, payload: AlertPayload, fetchImpl: typeof fetch) {
  const telegram = type === "telegram" ? parseTelegramTarget(target) : undefined;
  const destination = type === "email" ? emailWebhookUrl() : telegram ? telegramUrl(telegram.botToken) : target;
  const response = await fetchImpl(destination, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(formatAlertBody(type, payload, telegram?.chatId ?? target))
  });
  if (!response.ok) throw new Error(`alert delivery failed with ${response.status}`);
}

function formatAlertBody(type: string, payload: AlertPayload, target?: string) {
  const safePayload = redactLogValue(payload) as AlertPayload;
  const text = `${safePayload.message}${safePayload.runId ? ` (run ${safePayload.runId})` : ""}`;
  if (type === "slack") return { text, modeltruth: safePayload };
  if (type === "discord") return { content: text, embeds: [{ title: "ModelTruth Alert", description: safePayload.message }] };
  if (type === "email") return { to: target, subject: "ModelTruth Alert", text, modeltruth: safePayload };
  if (type === "telegram") return { chat_id: target, text, disable_web_page_preview: true };
  return { text, alert: safePayload };
}

function formatProviderDigestBody(payload: ProviderDigestPayload, email: string) {
  const providerName = payload.providerName ?? payload.providerSlug;
  const subject =
    payload.notificationType === "risk_trend"
      ? `ModelTruth Risk Trend: ${providerName}`
      : `ModelTruth Weekly Provider Digest: ${providerName}`;
  const text = [
    `${providerName} technical audit summary`,
    `Status: ${payload.status ?? "unknown"}`,
    `Uptime: ${formatPercent(payload.uptime)}`,
    `P95 TTFT: ${formatMs(payload.p95TtftMs)}`,
    `Audit pass rate: ${formatPercent(payload.auditPassRate)}`,
    `Risk flags: ${payload.riskFlagCount ?? 0}`,
    `Evidence score: ${payload.evidenceScore ?? 0}`,
    "Results are automated technical signals, not legal conclusions.",
    `Unsubscribe: ${providerUnsubscribeUrl(payload, email)}`
  ].join("\n");
  return { to: email, subject, text, modeltruth: { ...payload, subscriberEmails: undefined, unsubscribeUrl: providerUnsubscribeUrl(payload, email) } };
}

function formatPercent(value: number | undefined) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function formatMs(value: number | undefined) {
  return typeof value === "number" ? `${Math.round(value)}ms` : "n/a";
}

function parseTelegramTarget(target: string) {
  const parsed = JSON.parse(target) as { botToken?: unknown; chatId?: unknown };
  const botToken = String(parsed.botToken ?? "");
  const chatId = String(parsed.chatId ?? "");
  if (!botToken || !chatId) throw new Error("telegram alert target is invalid");
  return { botToken, chatId };
}

function telegramUrl(botToken: string) {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

function emailWebhookUrl() {
  const url = process.env.EMAIL_ALERT_WEBHOOK_URL;
  if (!url) throw new Error("EMAIL_ALERT_WEBHOOK_URL is required for email alert channels");
  return url;
}

function providerUnsubscribeUrl(payload: ProviderDigestPayload, email: string) {
  const url = new URL("/api/providers/unsubscribe", publicAppUrl());
  url.searchParams.set(
    "token",
    createProviderUnsubscribeToken({
      providerSlug: payload.providerSlug,
      email,
      notificationType: payload.notificationType
    })
  );
  return url.toString();
}

function publicAppUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_APP_URL ?? "https://modeltruth.ai").replace(/\/$/, "");
}

async function main() {
  if (process.env.SKIP_RUNTIME_DB_INIT !== "true") await ensureDatabaseReady();
  await runNotifierTick();
  if (process.env.RUN_ONCE === "1") return;
  const timer = setInterval(() => {
    runNotifierTick().catch((error) => writeJsonLog({ service: "notifier", event: "tick.failed", level: "error", error }));
  }, intervalMs);
  installGracefulShutdown({ service: "notifier", cleanup: () => clearInterval(timer) });
}

if (process.argv[1]?.endsWith("apps/notifier/src/index.ts")) {
  main().catch((error) => {
    writeJsonLog({ service: "notifier", event: "fatal", level: "error", error });
    process.exit(1);
  });
}
