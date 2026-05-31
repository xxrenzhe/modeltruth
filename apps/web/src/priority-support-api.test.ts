import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, createJobRepository, ensureSqliteReady } from "@modeltruth/db";
import { POST } from "./app/api/workspace/support/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("priority support API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication", async () => {
    const response = await POST(supportRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("authentication required");
  });

  it("blocks non-Team workspaces", async () => {
    await createSession("pro");

    const response = await POST(supportRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("priority support requires a Team subscription");
  });

  it("enqueues a Team priority support job with workspace contact context", async () => {
    const session = await createSession("team");

    const response = await POST(supportRequest());
    const body = await response.json();
    const jobs = await createJobRepository();
    const claimed = await jobs.claimNext({ workerId: "priority-support-test", types: ["prioritySupport"] });
    await jobs.close();
    const payload = JSON.parse(claimed?.payloadJson ?? "{}");

    expect(response.status).toBe(201);
    expect(body.supportRequest).toMatchObject({ id: claimed?.id, status: "queued", priority: "team" });
    expect(payload).toMatchObject({
      source: "workspace-priority-support",
      workspaceId: session.workspace.id,
      userId: session.user.id,
      contactEmail: "support-team@example.com",
      subject: "Vendor dispute escalation",
      message: "Please review this vendor dispute and billing evidence with priority handling.",
      priority: "team"
    });
  });
});

async function createSession(tier: "pro" | "team") {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-priority-support-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const email = tier === "team" ? "support-team@example.com" : "support-pro@example.com";
    const login = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!login) throw new Error("failed to create test session");
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({ workspaceId: login.session.workspace.id, subscriptionStatus: "active", tier });
    } finally {
      await billing.close();
    }
    const refreshedLogin = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!refreshedLogin) throw new Error("failed to refresh test session");
    cookieState.sessionToken = refreshedLogin.sessionToken;
    return refreshedLogin.session;
  } finally {
    await auth.close();
  }
}

function supportRequest() {
  return new Request("http://localhost/api/workspace/support", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: "Vendor dispute escalation",
      message: "Please review this vendor dispute and billing evidence with priority handling."
    })
  });
}
