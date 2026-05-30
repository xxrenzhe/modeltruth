import { NextResponse } from "next/server";
import { runSmokeAudit } from "@modeltruth/audit-engine";
import { saveAuditRun } from "@modeltruth/db";
import { redactSecrets } from "@modeltruth/crypto";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await request.json()
      : Object.fromEntries((await request.formData()).entries());

    const suite = String(body.suiteId ?? "smoke@1.0.0");
    const parsedSuite = parseSuiteId(suite);
    const result = await runSmokeAudit({
      baseUrl: String(body.baseUrl ?? ""),
      apiKey: String(body.apiKey ?? ""),
      model: String(body.model ?? ""),
      suiteId: suite
    });

    await saveAuditRun({
      id: result.runId,
      suiteId: parsedSuite.suiteId,
      suiteVersion: parsedSuite.suiteVersion,
      runType: "playground",
      targetModelId: String(body.model ?? ""),
      status: result.overallStatus,
      confidence: result.confidence,
      metrics: result.metrics,
      assertions: result.assertions,
      evidenceSummary: result.evidenceSummary,
      finishedAt: new Date().toISOString()
    });

    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "audit failed" }, { status: 400 });
  }
}

function parseSuiteId(value: string) {
  const [suiteId, suiteVersion = "1.0.0"] = value.split("@");
  return { suiteId: suiteId || "smoke", suiteVersion };
}
