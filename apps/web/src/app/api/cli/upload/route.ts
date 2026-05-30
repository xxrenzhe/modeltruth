import { NextResponse } from "next/server";
import { redactSecrets } from "@modeltruth/crypto";
import { getCurrentSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const body = await request.json();
  if (body.consent !== true) return NextResponse.json({ error: "consent=true is required" }, { status: 400 });

  const payload = redactSecrets({
    id: crypto.randomUUID(),
    workspaceId: session.workspace.id,
    receivedAt: new Date().toISOString(),
    schemaVersion: body.schemaVersion,
    runId: body.runId,
    status: body.status,
    confidence: body.confidence,
    metrics: body.metrics,
    assertions: body.assertions,
    evidenceSummary: body.evidenceSummary
  });

  return NextResponse.json({ uploaded: true, report: payload });
}
