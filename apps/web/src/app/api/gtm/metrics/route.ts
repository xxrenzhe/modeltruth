import { NextResponse } from "next/server";
import { buildGtmMetricsSnapshot } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";

export async function GET(request: Request) {
  const configuredToken = process.env.MODELTRUTH_GTM_METRICS_TOKEN;
  if (!configuredToken) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (bearerToken(request) !== configuredToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const windowDays = parseWindowDays(url.searchParams.get("windowDays"));
    const snapshot = await buildGtmMetricsSnapshot({ windowDays });
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid metrics request") }, { status: 400 });
  }
}

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function parseWindowDays(value: string | null) {
  if (!value) return 30;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 180) throw new Error("windowDays must be an integer between 1 and 180");
  return parsed;
}
