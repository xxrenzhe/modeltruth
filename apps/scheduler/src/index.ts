import { createJobRepository, createProviderNodeRepository, ensureDatabaseReady } from "@modeltruth/db";

const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);

export async function runSchedulerTick() {
  const jobs = await createJobRepository();
  const nodes = await createProviderNodeRepository();
  try {
    const now = new Date();
    const dueNodes = await nodes.listDueForSchedule(now);
    for (const node of dueNodes) {
      if (!node.nextHeartbeatAt || new Date(node.nextHeartbeatAt) <= now) {
        const job = await jobs.enqueue({
          type: "heartbeat",
          payload: { source: "scheduler", nodeId: node.id, scheduledAt: now.toISOString() }
        });
        await nodes.markScheduled(node.id, "heartbeat", new Date(now.getTime() + node.heartbeatIntervalSeconds * 1000));
        console.log(`[scheduler] enqueued ${job.type} job ${job.id} for node ${node.id}`);
      }
      if (!node.nextDeepAuditAt || new Date(node.nextDeepAuditAt) <= now) {
        const job = await jobs.enqueue({
          type: "deepAudit",
          payload: { source: "scheduler", nodeId: node.id, suiteId: "smoke@1.0.0", scheduledAt: now.toISOString() }
        });
        await nodes.markScheduled(node.id, "deepAudit", new Date(now.getTime() + node.deepAuditIntervalSeconds * 1000));
        console.log(`[scheduler] enqueued ${job.type} job ${job.id} for node ${node.id}`);
      }
    }
    if (dueNodes.length === 0) console.log("[scheduler] no provider nodes due");
  } finally {
    await nodes.close();
    await jobs.close();
  }
}

async function main() {
  await ensureDatabaseReady();
  await runSchedulerTick();
  if (process.env.RUN_ONCE === "1") return;
  setInterval(() => {
    runSchedulerTick().catch((error) => console.error("[scheduler] tick failed", error));
  }, intervalMs);
}

if (process.argv[1]?.endsWith("apps/scheduler/src/index.ts")) {
  main().catch((error) => {
    console.error("[scheduler] fatal", error);
    process.exit(1);
  });
}
