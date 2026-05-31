import { NextResponse } from "next/server";
import { createWorkspacePrivacyRepository } from "@modeltruth/db";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createWorkspacePrivacyRepository();
  try {
    const settings = await repo.get(session.workspace.id);
    return NextResponse.json({ settings });
  } finally {
    await repo.close();
  }
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const body = (await request.json()) as { saveFullResponses?: unknown };
  if (typeof body.saveFullResponses !== "boolean") {
    return NextResponse.json({ error: "saveFullResponses must be boolean" }, { status: 400 });
  }

  const repo = await createWorkspacePrivacyRepository();
  try {
    const settings = await repo.update(session.workspace.id, { saveFullResponses: body.saveFullResponses });
    return NextResponse.json({ settings });
  } finally {
    await repo.close();
  }
}
