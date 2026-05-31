import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthRepository,
  createBillingRepository,
  createWorkspaceMemberRepository,
  ensureSqliteReady
} from "@modeltruth/db";
import { GET, POST } from "./app/api/workspace/members/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("workspace member authorization", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication before listing or inviting members", async () => {
    const list = await GET();
    const invite = await POST(inviteRequest("teammate@example.com"));

    expect(list.status).toBe(401);
    expect((await list.json()).error).toBe("authentication required");
    expect(invite.status).toBe(401);
    expect((await invite.json()).error).toBe("authentication required");
  });

  it("blocks member invites for non-Team workspaces", async () => {
    await createSession("pro");

    const response = await POST(inviteRequest("teammate@example.com"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("team member invites require a Team subscription");
  });

  it("lets Team workspace owners invite members and list them", async () => {
    const session = await createSession("team");

    const invite = await POST(inviteRequest("Teammate@Example.com"));
    const inviteBody = await invite.json();
    const list = await GET();
    const listBody = await list.json();

    expect(invite.status).toBe(201);
    expect(inviteBody.member).toMatchObject({
      workspaceId: session.workspace.id,
      email: "teammate@example.com",
      role: "member",
      status: "invited",
      invitedByUserId: session.user.id
    });
    expect(listBody.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: "team-owner@example.com", role: "owner", status: "active" }),
        expect.objectContaining({ email: "teammate@example.com", role: "member", status: "invited" })
      ])
    );
  });

  it("rejects Team invites from non-owner active workspace members", async () => {
    const owner = await createSession("team");
    const memberRepo = await createWorkspaceMemberRepository();
    await memberRepo.invite({
      workspaceId: owner.workspace.id,
      invitedByUserId: owner.user.id,
      email: "active-member@example.com",
      role: "member"
    });
    await memberRepo.close();
    const auth = await createAuthRepository();
    const memberLogin = await auth.consumeMagicLink((await auth.createMagicLink("active-member@example.com")).token);
    await auth.close();
    if (!memberLogin) throw new Error("failed to create member session");
    cookieState.sessionToken = memberLogin.sessionToken;

    const response = await POST(inviteRequest("blocked@example.com"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("only workspace owners can invite team members");
  });
});

async function createSession(tier: "pro" | "team") {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-workspace-member-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const email = tier === "team" ? "team-owner@example.com" : "pro-owner@example.com";
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

function inviteRequest(email: string) {
  return new Request("http://localhost/api/workspace/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
}
