import { ensureDatabaseReady } from "@modeltruth/db";
import { createJobRepository } from "@modeltruth/db";

const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60_000);

export async function runSchedulerTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.enqueue({
      type: "heartbeat",
      payload: { source: "scheduler", scheduledAt: new Date().toISOString() }
    });
    console.log(`[scheduler] enqueued ${job.type} job ${job.id}`);
  } finally {
    await repo.close();
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

main().catch((error) => {
  console.error("[scheduler] fatal", error);
  process.exit(1);
});
