import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST } from "./app/api/workspace/alert-channels/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("Telegram alert channel API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("creates Telegram alert channels for paid workspaces without leaking bot tokens", async () => {
    await createPaidSession();

    const response = await POST(
      jsonRequest({
        type: "telegram",
        botToken: "123456789:telegramSecretTokenValue",
        chatId: "-1001234567890"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.channel.type).toBe("telegram");
    expect(body.channel.targetSuffix).toBe("telegram:-1001234567890");
    expect(JSON.stringify(body)).not.toContain("telegramSecretTokenValue");
  });

  it("rejects invalid Telegram targets", async () => {
    await createPaidSession();

    const response = await POST(jsonRequest({ type: "telegram", botToken: "bad", chatId: "bad" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("telegram bot token is invalid");
  });
});

async function createPaidSession() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-telegram-alert-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const link = await auth.createMagicLink("telegram-api@example.com");
    const login = await auth.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create test session");
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({
        workspaceId: login.session.workspace.id,
        subscriptionStatus: "active",
        tier: "pro"
      });
    } finally {
      await billing.close();
    }
    const refreshedLink = await auth.createMagicLink("telegram-api@example.com");
    const refreshedLogin = await auth.consumeMagicLink(refreshedLink.token);
    if (!refreshedLogin) throw new Error("failed to refresh test session");
    cookieState.sessionToken = refreshedLogin.sessionToken;
    return refreshedLogin.session;
  } finally {
    await auth.close();
  }
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/workspace/alert-channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
