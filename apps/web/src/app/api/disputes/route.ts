import { NextResponse } from "next/server";
import { createJobRepository, createProviderDisputeRepository } from "@modeltruth/db";
import { safeErrorMessage } from "@modeltruth/shared";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const providerSlug = parseProviderSlug(body.providerSlug);
    const requestType = parseRequestType(body.requestType);
    const contactEmail = parseEmail(body.contactEmail);
    const statement = parseStatement(body.statement);
    const evidenceUrl = parseOptionalUrl(body.evidenceUrl);
    const runId = typeof body.runId === "string" && body.runId.trim() ? body.runId.trim() : undefined;

    const repo = await createProviderDisputeRepository();
    try {
      const dispute = await repo.create({ providerSlug, requestType, contactEmail, statement, evidenceUrl, runId });
      await enqueueDisputeReview(dispute);
      return NextResponse.json({ dispute }, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (error) {
    return NextResponse.json({ error: safeErrorMessage(error, "invalid dispute") }, { status: 400 });
  }
}

async function enqueueDisputeReview(dispute: {
  id: string;
  providerSlug: string;
  runId?: string;
  requestType?: string;
  reviewDueAt?: string;
  reviewStartedAt?: string;
}) {
  const jobs = await createJobRepository();
  try {
    return await jobs.enqueue({
      type: "disputeReview",
      maxAttempts: 1,
      runAfter: new Date(dispute.reviewStartedAt ?? new Date().toISOString()),
      payload: {
        source: "dispute-policy",
        disputeId: dispute.id,
        providerSlug: dispute.providerSlug,
        requestType: dispute.requestType,
        runId: dispute.runId,
        reviewStartedAt: dispute.reviewStartedAt,
        reviewDueAt: dispute.reviewDueAt
      }
    });
  } finally {
    await jobs.close();
  }
}

function parseProviderSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9-]{2,64}$/.test(slug)) throw new Error("providerSlug is required");
  return slug;
}

function parseEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("valid contactEmail is required");
  return email;
}

function parseRequestType(value: unknown) {
  if (value === undefined || value === null || value === "") return "correction";
  if (value === "correction" || value === "takedown" || value === "provider_response") return value;
  throw new Error("requestType must be correction, takedown or provider_response");
}

function parseStatement(value: unknown) {
  const statement = typeof value === "string" ? value.trim() : "";
  if (statement.length < 20) throw new Error("statement must be at least 20 characters");
  return statement.slice(0, 5000);
}

function parseOptionalUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("evidenceUrl must use HTTPS");
  return url.toString();
}
