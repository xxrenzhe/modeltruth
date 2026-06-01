import { NextResponse } from "next/server";
import { createGtmAnalyticsRepository, type GtmTrafficSurface } from "@modeltruth/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.consent !== true) {
      return NextResponse.json({ recorded: false, reason: "consent_required" }, { status: 202 });
    }
    const repo = await createGtmAnalyticsRepository();
    try {
      await repo.recordVisit({
        surface: parseSurface(body.surface),
        visitorSeed: parseVisitorId(body.visitorId)
      });
    } finally {
      await repo.close();
    }
    return NextResponse.json({ recorded: true });
  } catch {
    return NextResponse.json({ recorded: false }, { status: 202 });
  }
}

function parseSurface(value: unknown): GtmTrafficSurface {
  const surface = typeof value === "string" ? value : "";
  if (["site", "public_dashboard", "provider_board", "playground", "pricing", "cli"].includes(surface)) {
    return surface as GtmTrafficSurface;
  }
  return "site";
}

function parseVisitorId(value: unknown) {
  const visitorId = typeof value === "string" ? value.trim() : "";
  return visitorId.length >= 3 && visitorId.length <= 120 ? visitorId : crypto.randomUUID();
}
