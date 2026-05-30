import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@modeltruth/db";

export async function GET() {
  const database = await checkDatabaseHealth();
  const status = database.ok ? 200 : 503;
  return NextResponse.json(
    {
      ok: database.ok,
      service: "modeltruth-web",
      database,
      timestamp: new Date().toISOString()
    },
    { status }
  );
}
