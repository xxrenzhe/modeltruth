import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createProviderSubscriptionRepository } from "./provider-subscriptions";

describe("ProviderSubscriptionRepository", () => {
  it("deduplicates active provider subscriptions by email and notification type", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-provider-subscriptions-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createProviderSubscriptionRepository();
    const first = await repo.create({ providerSlug: "openrouter", email: "dev@example.com" });
    const second = await repo.create({ providerSlug: "openrouter", email: "dev@example.com" });
    const digest = await repo.create({
      providerSlug: "openrouter",
      email: "dev@example.com",
      notificationType: "weekly_digest"
    });
    const subscriptions = await repo.listByProvider("openrouter");
    const subscriptionsByEmail = await repo.listByEmail("dev@example.com");
    await repo.close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(first.notificationType).toBe("risk_trend");
    expect(second.id).toBe(first.id);
    expect(digest.notificationType).toBe("weekly_digest");
    expect(subscriptions).toHaveLength(2);
    expect(subscriptionsByEmail.map((item) => item.providerSlug)).toEqual(["openrouter", "openrouter"]);
  });
});
