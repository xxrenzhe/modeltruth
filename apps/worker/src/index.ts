import { runSmokeAudit } from "@modeltruth/audit-engine";
import { createJobRepository, ensureDatabaseReady } from "@modeltruth/db";

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);
const workerId = `audit-worker-${process.pid}`;

export async function runWorkerTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.claimNext({ workerId, types: ["heartbeat", "deepAudit"] });
    if (!job) return;
    try {
      await runSmokeAudit({
        baseUrl: "https://api.example.com/v1",
        apiKey: "worker-placeholder-key",
        model: "gpt-5.1",
        suiteId: job.type === "deepAudit" ? "reasoning-lite@1.0.0" : "smoke@1.0.0"
      });
      await repo.complete(job.id);
      console.log(`[worker] completed ${job.type} job ${job.id}`);
    } catch (error) {
      await repo.fail(job.id, error instanceof Error ? error.message : String(error));
    }
  } finally {
    await repo.close();
  }
}

async function main() {
  await ensureDatabaseReady();
  await runWorkerTick();
  if (process.env.RUN_ONCE === "1") return;
  setInterval(() => {
    runWorkerTick().catch((error) => console.error("[worker] tick failed", error));
  }, intervalMs);
}

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});
