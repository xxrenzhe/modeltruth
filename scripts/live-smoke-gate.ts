import { runSmokeAudit } from "@modeltruth/audit-engine";

type LiveSmokeResult = {
  ok: boolean;
  skipped: boolean;
  message: string;
};

export async function runLiveSmokeGate(env: Record<string, string | undefined> = process.env): Promise<LiveSmokeResult> {
  const baseUrl = env.MODELTRUTH_LIVE_SMOKE_BASE_URL;
  const apiKey = env.MODELTRUTH_LIVE_SMOKE_API_KEY;
  const model = env.MODELTRUTH_LIVE_SMOKE_MODEL;
  const required = env.MODELTRUTH_LIVE_SMOKE_REQUIRED === "true";

  if (!baseUrl || !apiKey || !model) {
    const missing = [
      !baseUrl ? "MODELTRUTH_LIVE_SMOKE_BASE_URL" : undefined,
      !apiKey ? "MODELTRUTH_LIVE_SMOKE_API_KEY" : undefined,
      !model ? "MODELTRUTH_LIVE_SMOKE_MODEL" : undefined
    ].filter(Boolean);
    return {
      ok: !required,
      skipped: !required,
      message: `${required ? "missing" : "skipped"} live smoke gate: ${missing.join(", ")}`
    };
  }

  const result = await runSmokeAudit({
    baseUrl,
    apiKey,
    model,
    suiteId: "smoke@1.0.0",
    timeoutMs: Number(env.MODELTRUTH_LIVE_SMOKE_TIMEOUT_MS ?? 60000)
  });

  const passing = result.overallStatus === "pass" || result.overallStatus === "warning";
  return {
    ok: passing,
    skipped: false,
    message: `live smoke ${result.overallStatus}: run=${result.runId}, ttft=${result.metrics.ttftMs ?? "n/a"}ms, status=${result.metrics.statusCode ?? "n/a"}`
  };
}

async function main() {
  const result = await runLiveSmokeGate();
  const prefix = result.ok ? "[live-smoke-gate] passed" : "[live-smoke-gate] failed";
  const skipped = result.skipped ? " (optional)" : "";
  console.log(`${prefix}${skipped}: ${result.message}`);
  if (!result.ok) process.exit(1);
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error("[live-smoke-gate] failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
