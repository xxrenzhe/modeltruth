import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicAuditSummary } from "@modeltruth/db";

const getPublicAuditSummary = vi.fn<() => Promise<PublicAuditSummary>>();

vi.mock("@modeltruth/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@modeltruth/db")>();
  return {
    ...actual,
    getPublicAuditSummary
  };
});

describe("status page runtime rendering", () => {
  it("renders provider uptime, incident timeline and compact redacted evidence from the public audit summary", async () => {
    getPublicAuditSummary.mockResolvedValueOnce(publicAuditSummary);
    const { default: StatusPage } = await import("./app/[locale]/status/page");

    const html = renderToStaticMarkup(await StatusPage({ params: Promise.resolve({ locale: "en" }) }));

    expect(html).toContain("Provider uptime summary");
    expect(html).toContain("Incident timeline");
    expect(html).toContain("not legal conclusions");
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain("ModelTruth public AI API status signals");
    expect(html).toContain("30d audit runs");
    expect(html).toContain("42");
    expect(html).toContain("24h uptime");
    expect(html).toContain("98%");
    expect(html).toContain("Data freshness");
    expect(html).toContain("fresh / 2m");
    expect(html).toContain("OpenAI");
    expect(html).toContain("99%");
    expect(html).toContain("pass");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("91%");
    expect(html).toContain("warning");
    expect(html).toContain("openrouter / context-lite");
    expect(html).toContain("run run_status_incident");
    expect(html).toContain("router/deepseek-r1");
    expect(html).toContain("87%");
    expect(html).toContain("heartbeat");
    expect(html).toContain("active review");
    expect(html).toContain("suite 2026.06");
    expect(html).toContain("completion abcdef1234");
    expect(html).toContain("trace 00-0123456789abcd");
    expect(html).toContain("probe us-east-1");
  });
});

const window24h = {
  window: "24h" as const,
  totalRuns: 10,
  uptime: 0.98,
  passRate: 0.9,
  errorRate: 0.02,
  evidenceScore: 93
};

const window7d = {
  window: "7d" as const,
  totalRuns: 28,
  uptime: 0.97,
  passRate: 0.89,
  errorRate: 0.03,
  evidenceScore: 91
};

const window30d = {
  window: "30d" as const,
  totalRuns: 42,
  uptime: 0.96,
  passRate: 0.88,
  errorRate: 0.04,
  evidenceScore: 90
};

const publicAuditSummary: PublicAuditSummary = {
  totalRuns: 42,
  passRate: 0.88,
  errorRate: 0.04,
  p50TtftMs: 430,
  p95TtftMs: 980,
  evidenceScore: 90,
  lastRunAt: "2026-06-01T10:00:00.000Z",
  dataFreshnessSeconds: 91,
  isFresh: true,
  windows: {
    "24h": window24h,
    "7d": window7d,
    "30d": window30d
  },
  providers: [
    {
      providerSlug: "openai",
      windows: {
        "24h": { ...window24h, uptime: 0.99 },
        "7d": { ...window7d, uptime: 0.99 },
        "30d": { ...window30d, uptime: 0.98 }
      },
      riskFlags: [],
      evidenceScore: 95,
      lastRunAt: "2026-06-01T10:00:00.000Z",
      dataFreshnessSeconds: 91,
      isFresh: true
    },
    {
      providerSlug: "openrouter",
      windows: {
        "24h": { ...window24h, uptime: 0.91 },
        "7d": { ...window7d, uptime: 0.92 },
        "30d": { ...window30d, uptime: 0.93 }
      },
      riskFlags: [
        {
          riskFlagId: "risk_status_incident",
          riskFlagStatus: "active_review",
          runId: "run_status_incident",
          providerSlug: "openrouter",
          suiteId: "context-lite",
          runType: "heartbeat",
          targetModelId: "router/deepseek-r1",
          status: "warning",
          confidence: 0.87,
          metrics: { ttftMs: 1200, statusCode: 200 },
          assertions: [{ id: "CONTEXT_NEEDLE_RETRIEVAL", status: "warning" }],
          evidenceSummary: {
            suiteVersion: "2026.06",
            completionHash: "abcdef1234567890",
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
            externalProbe: true,
            probeRegion: "us-east-1"
          },
          createdAt: "2026-06-01T09:58:00.000Z"
        }
      ],
      evidenceScore: 86,
      lastRunAt: "2026-06-01T09:58:00.000Z",
      dataFreshnessSeconds: 120,
      isFresh: true
    }
  ],
  riskFlags: [
    {
      riskFlagId: "risk_status_incident",
      riskFlagStatus: "active_review",
      runId: "run_status_incident",
      providerSlug: "openrouter",
      suiteId: "context-lite",
      runType: "heartbeat",
      targetModelId: "router/deepseek-r1",
      status: "warning",
      confidence: 0.87,
      metrics: { ttftMs: 1200, statusCode: 200 },
      assertions: [{ id: "CONTEXT_NEEDLE_RETRIEVAL", status: "warning" }],
      evidenceSummary: {
        suiteVersion: "2026.06",
        completionHash: "abcdef1234567890",
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        externalProbe: true,
        probeRegion: "us-east-1"
      },
      createdAt: "2026-06-01T09:58:00.000Z"
    }
  ]
};
