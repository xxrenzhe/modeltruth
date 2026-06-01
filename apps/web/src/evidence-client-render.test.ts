import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { EvidenceCenterView, type AuditRunListItem } from "./app/[locale]/evidence/evidence-client";

describe("Evidence Center runtime rendering", () => {
  it("renders risk flags, evidence exports, monthly reports and redacted audit metadata", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceCenterView, {
        labels: {
          empty: "No audit evidence yet.",
          download: "Download JSON",
          riskFlags: "Risk Flags"
        },
        runs,
        currentMonth: "2026-06",
        onDeleteRun: () => undefined
      })
    );

    expect(html).toContain("Risk Flags");
    expect(html).toContain("run_warning");
    expect(html).toContain("openrouter/context-lite");
    expect(html).toContain("warning");
    expect(html).toContain("context-lite / heartbeat");
    expect(html).toContain("/api/evidence/run_warning");
    expect(html).toContain("/api/evidence/run_pass");
    expect(html).toContain("Monthly report");
    expect(html).toContain("Pro and Team workspaces can export a monthly audit report for billing and vendor reviews.");
    expect(html).toContain("/api/reports/monthly?month=2026-06");
    expect(html).toContain("Export 2026-06 report");
    expect(html).toContain("Model");
    expect(html).toContain("Suite");
    expect(html).toContain("Run type");
    expect(html).toContain("HTTP");
    expect(html).toContain("200");
    expect(html).toContain("TTFT");
    expect(html).toContain("1234ms");
    expect(html).toContain("Confidence");
    expect(html).toContain("87%");
    expect(html).toContain("Delete evidence");
    expect(html).not.toContain("sk-");
    expect(html).not.toContain("Authorization");
    expect(html).not.toContain("private prompt");
    expect(html).not.toContain("private completion");
  });
});

const runs: AuditRunListItem[] = [
  {
    runId: "run_warning",
    suiteId: "context-lite",
    runType: "heartbeat",
    targetModelId: "openrouter/context-lite",
    status: "warning",
    confidence: 0.87,
    metrics: { ttftMs: 1234, totalLatencyMs: 2100, statusCode: 200 },
    createdAt: "2026-06-01T10:00:00.000Z"
  },
  {
    runId: "run_pass",
    suiteId: "billing-check",
    runType: "deep_audit",
    targetModelId: "openai/gpt-5-mini",
    status: "pass",
    confidence: 0.96,
    metrics: { ttftMs: 420, totalLatencyMs: 900, statusCode: 200 },
    createdAt: "2026-06-01T09:00:00.000Z"
  }
];
