import { NextResponse } from "next/server";
import { createAuthRepository } from "@modeltruth/db";
import { getCurrentSession } from "../../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createAuthRepository();
  try {
    const exportData = await repo.exportUserData(session.user.id);
    if (!exportData) return NextResponse.json({ error: "user not found" }, { status: 404 });
    return NextResponse.json({
      schemaVersion: "modeltruth.privacy-export.v1",
      generatedAt: new Date().toISOString(),
      export: exportData
    });
  } finally {
    await repo.close();
  }
}
