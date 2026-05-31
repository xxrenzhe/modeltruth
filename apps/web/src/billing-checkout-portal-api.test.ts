import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST as checkout } from "./app/api/billing/checkout/route";
import { POST as portal } from "./app/api/billing/portal/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let previousStripeSecret: string | undefined;
let previousProPrice: string | undefined;
let previousTeamPrice: string | undefined;
let tempDir: string | undefined;

describe("billing checkout and portal API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousStripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousStripeSecret;
    if (previousProPrice === undefined) delete process.env.STRIPE_PRO_PRICE_ID;
    else process.env.STRIPE_PRO_PRICE_ID = previousProPrice;
    if (previousTeamPrice === undefined) delete process.env.STRIPE_TEAM_PRICE_ID;
    else process.env.STRIPE_TEAM_PRICE_ID = previousTeamPrice;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication before creating billing sessions", async () => {
    const checkoutResponse = await checkout(jsonRequest("http://localhost/api/billing/checkout", { tier: "pro" }));
    const portalResponse = await portal(new Request("http://localhost/api/billing/portal", { method: "POST" }));

    expect(checkoutResponse.status).toBe(401);
    expect((await checkoutResponse.json()).error).toBe("authentication required");
    expect(portalResponse.status).toBe(401);
    expect((await portalResponse.json()).error).toBe("authentication required");
  });

  it("creates Stripe Checkout sessions with workspace metadata and customer email", async () => {
    const session = await createSession();
    setupStripeEnv();
    const fetchMock = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("mode")).toBe("subscription");
      expect(body.get("client_reference_id")).toBe(session.workspace.id);
      expect(body.get("line_items[0][price]")).toBe("price_team");
      expect(body.get("customer_email")).toBe("billing-route@example.com");
      expect(body.get("subscription_data[metadata][workspaceId]")).toBe(session.workspace.id);
      expect(body.get("subscription_data[metadata][tier]")).toBe("team");
      expect(init?.headers).toMatchObject({ authorization: "Bearer sk_stripe_route" });
      return new Response(JSON.stringify({ id: "cs_route", url: "https://checkout.stripe.com/cs_route" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await checkout(jsonRequest("http://localhost/api/billing/checkout", { tier: "team" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "cs_route", url: "https://checkout.stripe.com/cs_route" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.stripe.com/v1/checkout/sessions", expect.any(Object));
  });

  it("rejects unsupported Checkout tiers", async () => {
    await createSession();
    setupStripeEnv();

    const response = await checkout(jsonRequest("http://localhost/api/billing/checkout", { tier: "enterprise" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("unsupported billing tier");
  });

  it("creates Stripe Customer Portal sessions only after the workspace has a Stripe customer", async () => {
    const session = await createSession();
    setupStripeEnv();
    const missing = await portal(new Request("http://localhost/api/billing/portal", { method: "POST" }));
    const missingBody = await missing.json();
    const billing = await createBillingRepository();
    await billing.updateWorkspaceBilling({
      workspaceId: session.workspace.id,
      stripeCustomerId: "cus_route",
      stripeSubscriptionId: "sub_route",
      subscriptionStatus: "active",
      tier: "pro"
    });
    await billing.close();
    const fetchMock = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("customer")).toBe("cus_route");
      expect(body.get("return_url")).toBe("http://localhost/en/pricing");
      return new Response(JSON.stringify({ id: "bps_route", url: "https://billing.stripe.com/session/bps_route" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await portal(new Request("http://localhost/api/billing/portal", { method: "POST" }));
    const body = await response.json();

    expect(missing.status).toBe(409);
    expect(missingBody.error).toBe("workspace has no Stripe customer");
    expect(response.status).toBe(200);
    expect(body).toEqual({ id: "bps_route", url: "https://billing.stripe.com/session/bps_route" });
  });
});

async function createSession() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-billing-route-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const login = await auth.consumeMagicLink((await auth.createMagicLink("billing-route@example.com")).token);
    if (!login) throw new Error("failed to create billing route session");
    cookieState.sessionToken = login.sessionToken;
    return login.session;
  } finally {
    await auth.close();
  }
}

function setupStripeEnv() {
  previousStripeSecret = process.env.STRIPE_SECRET_KEY;
  previousProPrice = process.env.STRIPE_PRO_PRICE_ID;
  previousTeamPrice = process.env.STRIPE_TEAM_PRICE_ID;
  process.env.STRIPE_SECRET_KEY = "sk_stripe_route";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro";
  process.env.STRIPE_TEAM_PRICE_ID = "price_team";
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
