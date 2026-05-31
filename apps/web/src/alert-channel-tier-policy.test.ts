import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, ensureSqliteReady } from "@modeltruth/db";
import { GET, POST } from "./app/api/workspace/alert-channels/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("alert channel tier policy", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("blocks Free workspaces from creating alert channels", async () => {
    await createSession("free");

    const response = await POST(emailAlertRequest("alerts@example.com"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Alert channels require a Pro or Team subscription");
  });

  it("requires authentication before listing or creating alert channels", async () => {
    const list = await GET();
    const create = await POST(emailAlertRequest("alerts@example.com"));

    expect(list.status).toBe(401);
    expect(await list.json()).toEqual({ error: "authentication required" });
    expect(create.status).toBe(401);
    expect(await create.json()).toEqual({ error: "authentication required" });
  });

  it("enforces the Pro alert channel quota at two channels", async () => {
    await createSession("pro");

    const first = await POST(emailAlertRequest("first@example.com"));
    const second = await POST(emailAlertRequest("second@example.com"));
    const third = await POST(emailAlertRequest("third@example.com"));
    const thirdBody = await third.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(400);
    expect(thirdBody.error).toBe("pro plan supports up to 2 active alert channels");
  });

  it("allows Team workspaces to exceed the Pro alert channel quota", async () => {
    await createSession("team");

    const responses = await Promise.all([
      POST(emailAlertRequest("one@example.com")),
      POST(emailAlertRequest("two@example.com")),
      POST(emailAlertRequest("three@example.com"))
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
  });

  it("lists only safe alert channel metadata and rejects local webhook targets", async () => {
    await createSession("team");

    const slack = await POST(urlAlertRequest("slack", "https://hooks.slack.example.com/services/modeltruth-secret"));
    const discord = await POST(urlAlertRequest("discord", "https://discord.example.com/api/webhooks/modeltruth-secret"));
    const blocked = await POST(urlAlertRequest("webhook", "https://127.0.0.1/hooks/private"));
    const list = await GET();
    const serialized = JSON.stringify(await list.json());

    expect(slack.status).toBe(201);
    expect(discord.status).toBe(201);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "local alert targets are not allowed" });
    expect(list.status).toBe(200);
    expect(serialized).toContain("slack");
    expect(serialized).toContain("discord");
    expect(serialized).not.toContain("modeltruth-secret");
    expect(serialized).not.toContain("hooks.slack.example.com/services");
  });
});

async function createSession(tier: "free" | "pro" | "team") {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-alert-tier-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const login = await auth.consumeMagicLink((await auth.createMagicLink(`alert-${tier}@example.com`)).token);
    if (!login) throw new Error("failed to create test session");
    if (tier !== "free") {
      const billing = await createBillingRepository();
      try {
        await billing.updateWorkspaceBilling({ workspaceId: login.session.workspace.id, subscriptionStatus: "active", tier });
      } finally {
        await billing.close();
      }
    }
    const refreshedLogin = await auth.consumeMagicLink((await auth.createMagicLink(`alert-${tier}@example.com`)).token);
    if (!refreshedLogin) throw new Error("failed to refresh test session");
    cookieState.sessionToken = refreshedLogin.sessionToken;
  } finally {
    await auth.close();
  }
}

function emailAlertRequest(target: string) {
  return new Request("http://localhost/api/workspace/alert-channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "email", target })
  });
}

function urlAlertRequest(type: "webhook" | "slack" | "discord", target: string) {
  return new Request("http://localhost/api/workspace/alert-channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, target })
  });
}
