import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProviderDisputeRecord, PublicAuditSummary } from "@modeltruth/db";

const getPublicAuditSummary = vi.fn<() => Promise<PublicAuditSummary>>();
const listByProvider = vi.fn<(providerSlug: string) => Promise<ProviderDisputeRecord[]>>();
const closeDisputeRepository = vi.fn<() => Promise<void>>();

vi.mock("@modeltruth/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@modeltruth/db")>();
  return {
    ...actual,
    getPublicAuditSummary,
    createProviderDisputeRepository: vi.fn(async () => ({
      listByProvider,
      close: closeDisputeRepository
    }))
  };
});

describe("provider truth board runtime rendering", () => {
  it("renders audit windows, public risk evidence and dispute status from database-backed summaries", async () => {
    getPublicAuditSummary.mockResolvedValueOnce(openRouterSummary);
    listByProvider.mockResolvedValueOnce(providerDisputes);
    const { default: ProviderPage } = await import("./app/[locale]/providers/[providerSlug]/page");

    const html = renderToStaticMarkup(
      await ProviderPage({ params: Promise.resolve({ locale: "en", providerSlug: "openrouter" }) })
    );

    expect(getPublicAuditSummary).toHaveBeenCalledWith({ providerSlug: "openrouter" });
    expect(listByProvider).toHaveBeenCalledWith("openrouter");
    expect(closeDisputeRepository).toHaveBeenCalledTimes(1);
    expect(html).toContain("Provider Truth Board");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("not legal conclusions");
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("OpenRouter AI API audit signals");
    expect(html).toContain("24h uptime");
    expect(html).toContain("97%");
    expect(html).toContain("30d P95 TTFT");
    expect(html).toContain("1180ms");
    expect(html).toContain("Risk flags");
    expect(html).toContain("Evidence score");
    expect(html).toContain("88");
    expect(html).toContain("fresh / 4m");
    expect(html).toContain("24h runs / 92% pass");
    expect(html).toContain("7d runs / 8% risk");
    expect(html).toContain("30d runs / P50 510ms");
    expect(html).toContain("Anonymous evidence trace");
    expect(html).toContain("run_provider_warning");
    expect(html).toContain("context-lite / heartbeat");
    expect(html).toContain("router/auto");
    expect(html).toContain("84%");
    expect(html).toContain("suite 2026.06");
    expect(html).toContain("completion fedcba9876");
    expect(html).toContain("trace 00-fedcba98765432");
    expect(html).toContain("probe eu-west-1");
    expect(html).toContain("Provider response status");
    expect(html).toContain("Updated after review");
    expect(html).toContain("Provider response: Run run_provider_warning");
    expect(html).toContain("POST /api/disputes");
    expect(html).not.toContain("sk-");
    expect(html).not.toContain("private prompt");
    expect(html).not.toContain("private completion");
  });
});

const openRouterSummary: PublicAuditSummary = {
  totalRuns: 31,
  passRate: 0.74,
  errorRate: 0.12,
  p50TtftMs: 510,
  p95TtftMs: 1180,
  evidenceScore: 88,
  lastRunAt: "2026-06-01T08:00:00.000Z",
  dataFreshnessSeconds: 181,
  isFresh: true,
  windows: {
    "24h": {
      window: "24h",
      totalRuns: 12,
      uptime: 0.97,
      passRate: 0.92,
      errorRate: 0.03,
      p50TtftMs: 480,
      p95TtftMs: 1020,
      evidenceScore: 91
    },
    "7d": {
      window: "7d",
      totalRuns: 24,
      uptime: 0.92,
      passRate: 0.79,
      errorRate: 0.08,
      p50TtftMs: 500,
      p95TtftMs: 1120,
      evidenceScore: 89
    },
    "30d": {
      window: "30d",
      totalRuns: 31,
      uptime: 0.88,
      passRate: 0.74,
      errorRate: 0.12,
      p50TtftMs: 510,
      p95TtftMs: 1180,
      evidenceScore: 88
    }
  },
  providers: [],
  riskFlags: [
    {
      riskFlagId: "risk_provider_warning",
      riskFlagStatus: "provider_response_attached",
      runId: "run_provider_warning",
      providerSlug: "openrouter",
      suiteId: "context-lite",
      runType: "heartbeat",
      targetModelId: "router/auto",
      status: "warning",
      confidence: 0.84,
      metrics: { ttftMs: 1280, statusCode: 200 },
      assertions: [{ id: "CONTEXT_NEEDLE_RETRIEVAL", status: "warning" }],
      evidenceSummary: {
        suiteVersion: "2026.06",
        completionHash: "fedcba9876543210",
        traceparent: "00-fedcba9876543210fedcba9876543210-fedcba9876543210-01",
        externalProbe: true,
        probeRegion: "eu-west-1",
        redactionApplied: true
      },
      createdAt: "2026-06-01T07:59:00.000Z"
    }
  ]
};

const providerDisputes: ProviderDisputeRecord[] = [
  {
    id: "dispute_provider_response",
    providerSlug: "openrouter",
    runId: "run_provider_warning",
    requestType: "provider_response",
    contactEmail: "provider@example.com",
    statement: "Provider supplied a technical correction.",
    status: "provider_response_attached",
    reviewDueAt: "2026-06-03T08:00:00.000Z",
    reviewStartedAt: "2026-06-01T08:10:00.000Z",
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:10:00.000Z"
  }
];
