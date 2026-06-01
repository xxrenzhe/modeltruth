import { NextResponse } from "next/server";
import { buildMonthlyAuditReport } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";
import { canExportMonthlyAuditReport } from "../../../../lib/report-access";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (!canExportMonthlyAuditReport(session)) {
    return NextResponse.json({ error: "monthly audit report export requires Pro or Team" }, { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? currentUtcMonth();
    const report = await buildMonthlyAuditReport({ workspaceId: session.workspace.id, month });
    return NextResponse.json(
      { report },
      {
        headers: {
          "content-disposition": `attachment; filename="modeltruth-${session.workspace.id}-${month}.json"`
        }
      }
    );
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid report request") }, { status: 400 });
  }
}

function currentUtcMonth() {
  return new Date().toISOString().slice(0, 7);
}
