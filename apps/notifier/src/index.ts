import { decryptSecret } from "@modeltruth/crypto";
import { createAlertChannelRepository, createJobRepository, ensureDatabaseReady } from "@modeltruth/db";
import { installGracefulShutdown, writeJsonLog } from "@modeltruth/shared";

const intervalMs = Number(process.env.NOTIFIER_POLL_INTERVAL_MS ?? 5000);
const workerId = `notifier-${process.pid}`;

export async function runNotifierTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.claimNext({ workerId, types: ["alert"] });
    if (!job) return;
    try {
      const payload = parseAlertPayload(job.payloadJson);
      const delivered = await deliverAlert(payload);
      writeJsonLog({
        service: "notifier",
        event: "alert.delivered",
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
  const text = `${payload.message}${payload.runId ? ` (run ${payload.runId})` : ""}`;
  if (type === "slack") return { text, modeltruth: payload };
  if (type === "discord") return { content: text, embeds: [{ title: "ModelTruth Alert", description: payload.message }] };
  if (type === "email") return { to: target, subject: "ModelTruth Alert", text, modeltruth: payload };
  if (type === "telegram") return { chat_id: target, text, disable_web_page_preview: true };
  return { text, alert: payload };
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
