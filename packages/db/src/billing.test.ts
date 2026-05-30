import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";
import { createBillingRepository } from "./billing";

describe("BillingRepository", () => {
  it("updates workspace subscription state and deduplicates Stripe events", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-billing-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("billing@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const billing = await createBillingRepository();
    const firstEvent = await billing.markStripeEventProcessed("evt_1", "checkout.session.completed", "{}");
    const duplicateEvent = await billing.markStripeEventProcessed("evt_1", "checkout.session.completed", "{}");
    await billing.updateWorkspaceBilling({
      workspaceId: session!.session.workspace.id,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      subscriptionStatus: "active",
      tier: "pro"
    });
    const active = await billing.getWorkspaceBilling(session!.session.workspace.id);
    await billing.updateWorkspaceBilling({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      subscriptionStatus: "canceled",
      tier: "pro"
    });
    const canceled = await billing.getWorkspaceBilling(session!.session.workspace.id);
    await billing.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(firstEvent).toBe(true);
    expect(duplicateEvent).toBe(false);
    expect(active?.tier).toBe("pro");
    expect(active?.subscriptionStatus).toBe("active");
    expect(canceled?.tier).toBe("free");
    expect(canceled?.subscriptionStatus).toBe("canceled");
  });
});
