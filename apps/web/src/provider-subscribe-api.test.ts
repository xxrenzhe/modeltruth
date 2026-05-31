import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderSubscriptionRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST } from "./app/api/providers/subscribe/route";

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("provider subscribe API", () => {
  afterEach(() => {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("accepts form subscriptions and returns only public subscription metadata", async () => {
    await setupDatabase();
    const response = await POST(
      new Request("http://localhost/api/providers/subscribe", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          providerSlug: "OpenRouter",
          email: "Dev@Example.com",
          notificationType: "risk_trend"
        })
      })
    );
    const body = await response.json();
    const repo = await createProviderSubscriptionRepository();
    const subscriptions = await repo.listByProvider("openrouter");
    await repo.close();

    expect(response.status).toBe(201);
    expect(body.subscription).toMatchObject({
      providerSlug: "openrouter",
      notificationType: "risk_trend",
      status: "active"
    });
    expect(JSON.stringify(body)).not.toContain("dev@example.com");
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].email).toBe("dev@example.com");
  });

  it("rejects invalid notification types", async () => {
    await setupDatabase();
    const response = await POST(jsonRequest({ providerSlug: "openai", email: "dev@example.com", notificationType: "sms" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "notificationType must be risk_trend or weekly_digest" });
  });
});

async function setupDatabase() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-provider-subscribe-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/providers/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
