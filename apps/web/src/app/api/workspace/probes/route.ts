import { NextResponse } from "next/server";
import { createByoProbeRepository } from "@modeltruth/db";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createByoProbeRepository();
  try {
    return NextResponse.json({ probes: await repo.list(session.workspace.id) });
  } finally {
    await repo.close();
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (session.workspace.tier !== "team") {
    return NextResponse.json({ error: "BYO probe registration requires a Team subscription" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const repo = await createByoProbeRepository();
    try {
      const result = await repo.register({
        workspaceId: session.workspace.id,
        name: String(body.name ?? ""),
        region: String(body.region ?? "")
      });
      return NextResponse.json(result, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid probe registration" }, { status: 400 });
  }
}
