import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderUnsubscribeToken } from "@modeltruth/crypto";
import { createProviderSubscriptionRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST } from "./app/api/providers/subscribe/route";
import { GET as unsubscribeGet, POST as unsubscribe } from "./app/api/providers/unsubscribe/route";
import { expectResponseKeysCamelCase } from "./test-utils/response-key-case";

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
    expectResponseKeysCamelCase(body);
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

  it("rejects unsupported provider slugs before creating digest subscriptions", async () => {
    await setupDatabase();
    const response = await POST(jsonRequest({ providerSlug: "made-up-provider", email: "dev@example.com" }));
    const repo = await createProviderSubscriptionRepository();
    const subscriptions = await repo.listByEmail("dev@example.com");
    await repo.close();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "providerSlug is not supported" });
    expect(subscriptions).toHaveLength(0);
  });

  it("unsubscribes provider notification types without exposing subscriber email", async () => {
    await setupDatabase();
    const repo = await createProviderSubscriptionRepository();
    await repo.create({ providerSlug: "openrouter", email: "dev@example.com", notificationType: "risk_trend" });
    await repo.create({ providerSlug: "openrouter", email: "dev@example.com", notificationType: "weekly_digest" });
    await repo.close();

    const response = await unsubscribe(jsonRequest({ providerSlug: "openrouter", email: "Dev@Example.com", notificationType: "risk_trend" }));
    const body = await response.json();
    const check = await createProviderSubscriptionRepository();
    const subscriptions = await check.listByEmail("dev@example.com");
    await check.close();

    expect(response.status).toBe(200);
    expectResponseKeysCamelCase(body);
    expect(body.subscription).toEqual({ providerSlug: "openrouter", notificationType: "risk_trend", status: "unsubscribed" });
    expect(JSON.stringify(body)).not.toContain("dev@example.com");
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].notificationType).toBe("weekly_digest");
  });

  it("supports one-click GET unsubscribe links from provider digest emails", async () => {
    await setupDatabase();
    const repo = await createProviderSubscriptionRepository();
    await repo.create({ providerSlug: "openrouter", email: "digest@example.com", notificationType: "weekly_digest" });
    await repo.close();
    const token = createProviderUnsubscribeToken({
      providerSlug: "openrouter",
      email: "digest@example.com",
      notificationType: "weekly_digest"
    });

    const response = await unsubscribeGet(
      new Request(`http://localhost/api/providers/unsubscribe?token=${encodeURIComponent(token)}`)
    );
    const body = await response.json();
    const check = await createProviderSubscriptionRepository();
    const subscriptions = await check.listByEmail("digest@example.com");
    await check.close();

    expect(response.status).toBe(200);
    expectResponseKeysCamelCase(body);
    expect(body.subscription).toEqual({ providerSlug: "openrouter", notificationType: "weekly_digest", status: "unsubscribed" });
    expect(subscriptions).toHaveLength(0);
  });

  it("rejects one-click GET unsubscribe links that expose raw subscriber email", async () => {
    await setupDatabase();

    const response = await unsubscribeGet(
      new Request(
        "http://localhost/api/providers/unsubscribe?providerSlug=openrouter&email=digest%40example.com&notificationType=weekly_digest"
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsubscribe token is required" });
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
