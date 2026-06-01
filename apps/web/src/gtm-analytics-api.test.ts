import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGtmMetricsSnapshot, ensureSqliteReady } from "@modeltruth/db";
import { POST as recordExternalMetric } from "./app/api/gtm/external-metrics/route";
import { POST as recordVisit } from "./app/api/gtm/visit/route";

let previousDatabasePath: string | undefined;
let previousToken: string | undefined;
let tempDir: string | undefined;

describe("GTM analytics APIs", () => {
  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousToken === undefined) delete process.env.MODELTRUTH_GTM_METRICS_TOKEN;
    else process.env.MODELTRUTH_GTM_METRICS_TOKEN = previousToken;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("records privacy-preserving visit surfaces without storing raw paths", async () => {
    await setupDatabase();
    const first = await recordVisit(jsonRequest("http://localhost/api/gtm/visit", {
      surface: "provider_board",
      visitorId: "browser-visitor-1",
      path: "/en/providers/openrouter"
    }));
    const second = await recordVisit(jsonRequest("http://localhost/api/gtm/visit", {
      surface: "provider_board",
      visitorId: "browser-visitor-1"
    }));
    const snapshot = await buildGtmMetricsSnapshot({ now: new Date(), windowDays: 30 });
    const serialized = JSON.stringify(snapshot);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(snapshot.launch.monthlyVisits).toBe(2);
    expect(snapshot.launch.dashboardWeeklyActiveVisitors).toBe(1);
    expect(serialized).not.toContain("browser-visitor-1");
    expect(serialized).not.toContain("/en/providers/openrouter");
  });

  it("requires the internal token before importing CLI influence snapshots", async () => {
    await setupDatabase();
    process.env.MODELTRUTH_GTM_METRICS_TOKEN = "gtm_secret";

    const denied = await recordExternalMetric(jsonRequest("http://localhost/api/gtm/external-metrics", {
      source: "github_stars",
      metricValue: 1001
    }));
    const allowed = await recordExternalMetric(jsonRequest(
      "http://localhost/api/gtm/external-metrics",
      { source: "github_stars", metricValue: 1001, metadata: { repo: "xxrenzhe/modeltruth", token: "sk-secret" } },
      "Bearer gtm_secret"
    ));
    const snapshot = await buildGtmMetricsSnapshot({ now: new Date(), windowDays: 30 });

    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
    expect(snapshot.launch.githubStars).toBe(1001);
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret");
  });
});

async function setupDatabase() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-gtm-analytics-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  previousToken = process.env.MODELTRUTH_GTM_METRICS_TOKEN;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
}

function jsonRequest(url: string, body: unknown, authorization?: string) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {})
    },
    body: JSON.stringify(body)
  });
}
