import { NextResponse } from "next/server";
import { getEvidencePackage } from "@modeltruth/db";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const evidence = await getEvidencePackage(runId);
  if (!evidence) {
    return NextResponse.json({ error: "evidence_not_found", runId }, { status: 404 });
  }
  return NextResponse.json({ evidence });
}
