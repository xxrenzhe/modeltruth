import { NextResponse } from "next/server";
import { createGtmAnalyticsRepository, type GtmExternalMetricSource } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";

export async function POST(request: Request) {
  const configuredToken = process.env.MODELTRUTH_GTM_METRICS_TOKEN;
  if (!configuredToken) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (bearerToken(request) !== configuredToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const repo = await createGtmAnalyticsRepository();
    try {
      await repo.upsertExternalMetric({
        source: parseSource(body.source),
        metricValue: parseMetricValue(body.metricValue),
        metadata: parseMetadata(body.metadata)
      });
    } finally {
      await repo.close();
    }
    return NextResponse.json({ recorded: true });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid external metric") }, { status: 400 });
  }
}

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function parseSource(value: unknown): GtmExternalMetricSource {
  if (value === "github_stars" || value === "package_downloads" || value === "cli_installs") return value;
  throw new Error("invalid external metric source");
}

function parseMetricValue(value: unknown) {
  const metricValue = Number(value);
  if (!Number.isInteger(metricValue) || metricValue < 0) throw new Error("metricValue must be a non-negative integer");
  return metricValue;
}

function parseMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
