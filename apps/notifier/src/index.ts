import { decryptSecret } from "@modeltruth/crypto";
import { createAlertChannelRepository, createJobRepository, ensureDatabaseReady } from "@modeltruth/db";

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
      console.log(`[notifier] delivered alert job ${job.id} to ${delivered} channels`);
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
    createdAt: payload.createdAt
  };
}

async function postAlert(target: string, type: string, payload: AlertPayload, fetchImpl: typeof fetch) {
  const response = await fetchImpl(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(formatAlertBody(type, payload))
  });
  if (!response.ok) throw new Error(`alert delivery failed with ${response.status}`);
}

function formatAlertBody(type: string, payload: AlertPayload) {
  const text = `${payload.message}${payload.runId ? ` (run ${payload.runId})` : ""}`;
  if (type === "slack") return { text, modeltruth: payload };
  if (type === "discord") return { content: text, embeds: [{ title: "ModelTruth Alert", description: payload.message }] };
  return { text, alert: payload };
}

async function main() {
  await ensureDatabaseReady();
  await runNotifierTick();
  if (process.env.RUN_ONCE === "1") return;
  setInterval(() => {
    runNotifierTick().catch((error) => console.error("[notifier] tick failed", error));
  }, intervalMs);
}

if (process.argv[1]?.endsWith("apps/notifier/src/index.ts")) {
  main().catch((error) => {
    console.error("[notifier] fatal", error);
    process.exit(1);
  });
}
