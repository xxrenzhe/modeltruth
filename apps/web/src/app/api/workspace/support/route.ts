import { NextResponse } from "next/server";
import { createJobRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";
import { getCurrentSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  if (session.workspace.tier !== "team") {
    return NextResponse.json({ error: "priority support requires a Team subscription" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const subject = parseSubject(body.subject);
    const message = parseMessage(body.message);
    const jobs = await createJobRepository();
    try {
      const job = await jobs.enqueue({
        type: "prioritySupport",
        maxAttempts: 1,
        payload: {
          source: "workspace-priority-support",
          workspaceId: session.workspace.id,
          userId: session.user.id,
          contactEmail: session.user.email,
          subject,
          message,
          priority: "team"
        }
      });
      return NextResponse.json({ supportRequest: { id: job.id, status: job.status, priority: "team" } }, { status: 201 });
    } finally {
      await jobs.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid support request") }, { status: 400 });
  }
}

function parseSubject(value: unknown) {
  const subject = typeof value === "string" ? value.trim() : "";
  if (subject.length < 3) throw new Error("subject must be at least 3 characters");
  return subject.slice(0, 160);
}

function parseMessage(value: unknown) {
  const message = typeof value === "string" ? value.trim() : "";
  if (message.length < 20) throw new Error("message must be at least 20 characters");
  return message.slice(0, 5000);
}
