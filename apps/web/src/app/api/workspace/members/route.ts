import { NextResponse } from "next/server";
import { createWorkspaceMemberRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const repo = await createWorkspaceMemberRepository();
  try {
    return NextResponse.json({ members: await repo.list(session.workspace.id) });
  } finally {
    await repo.close();
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (session.workspace.tier !== "team") {
    return NextResponse.json({ error: "team member invites require a Team subscription" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const repo = await createWorkspaceMemberRepository();
    try {
      const role = await repo.getRole(session.workspace.id, session.user.id);
      if (role !== "owner") {
        return NextResponse.json({ error: "only workspace owners can invite team members" }, { status: 403 });
      }
      const member = await repo.invite({
        workspaceId: session.workspace.id,
        invitedByUserId: session.user.id,
        email: String(body.email ?? ""),
        role: "member"
      });
      return NextResponse.json({ member }, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid member invite") }, { status: 400 });
  }
}
