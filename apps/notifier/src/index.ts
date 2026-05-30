import { createJobRepository, ensureDatabaseReady } from "@modeltruth/db";

const intervalMs = Number(process.env.NOTIFIER_POLL_INTERVAL_MS ?? 5000);
const workerId = `notifier-${process.pid}`;

export async function runNotifierTick() {
  const repo = await createJobRepository();
  try {
    const job = await repo.claimNext({ workerId, types: ["alert"] });
    if (!job) return;
    console.log(`[notifier] delivered alert job ${job.id}`);
    await repo.complete(job.id);
  } finally {
    await repo.close();
  }
}

async function main() {
  await ensureDatabaseReady();
  await runNotifierTick();
  if (process.env.RUN_ONCE === "1") return;
  setInterval(() => {
    runNotifierTick().catch((error) => console.error("[notifier] tick failed", error));
  }, intervalMs);
}

main().catch((error) => {
  console.error("[notifier] fatal", error);
  process.exit(1);
});
