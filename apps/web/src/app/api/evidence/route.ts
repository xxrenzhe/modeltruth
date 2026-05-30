import { NextResponse } from "next/server";
import { getPublicAuditSummary, listAuditRuns } from "@modeltruth/db";
import { getCurrentSession } from "../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("scope") === "public") {
    return NextResponse.json({ summary: await getPublicAuditSummary() });
  }

  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const runs = await listAuditRuns({ workspaceId: session.workspace.id, limit: 100 });
  return NextResponse.json({ runs });
}
