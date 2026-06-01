import { NextResponse } from "next/server";
import { createProviderDisputeRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";

type ReviewStatus = "under_review" | "resolved" | "provider_response_attached";

export async function POST(request: Request) {
  const configuredToken = process.env.MODELTRUTH_ADMIN_TOKEN;
  if (!configuredToken) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (bearerToken(request) !== configuredToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const disputeId = parseDisputeId(body.disputeId);
    const status = parseStatus(body.status);
    const repo = await createProviderDisputeRepository();
    try {
      const dispute =
        status === "resolved"
          ? await repo.markResolved(disputeId)
          : status === "provider_response_attached"
            ? await repo.markProviderResponseAttached(disputeId)
            : await repo.markReviewStarted(disputeId);
      if (!dispute) return NextResponse.json({ error: "dispute not found" }, { status: 404 });
      return NextResponse.json({ dispute });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid dispute review") }, { status: 400 });
  }
}

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function parseDisputeId(value: unknown) {
  const disputeId = typeof value === "string" ? value.trim() : "";
  if (!disputeId) throw new Error("disputeId is required");
  return disputeId;
}

function parseStatus(value: unknown): ReviewStatus {
  if (value === "under_review" || value === "resolved" || value === "provider_response_attached") return value;
  throw new Error("status must be under_review, resolved or provider_response_attached");
}
