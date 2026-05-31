import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, createJobRepository, createProviderNodeRepository, ensureSqliteReady } from "@modeltruth/db";
import { decryptSecret } from "@modeltruth/crypto";
import { DELETE, GET, POST } from "./app/api/workspace/nodes/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("workspace nodes API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication", async () => {
    const list = await GET();
    const create = await POST(nodeRequest("Unauthenticated", "sk-unauth-secret-123456"));

    expect(list.status).toBe(401);
    expect((await list.json()).error).toBe("authentication required");
    expect(create.status).toBe(401);
    expect((await create.json()).error).toBe("authentication required");
  });

  it("blocks Free workspaces from creating private provider nodes", async () => {
    await createSession("free");

    const response = await POST(nodeRequest("Free node", "sk-free-secret-123456"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Private node monitoring requires a Pro or Team subscription");
  });

  it("creates encrypted Pro nodes, clamps schedule intervals and enforces the Pro cap", async () => {
    await createSession("pro");

    const responses = [];
    for (let index = 0; index < 4; index += 1) {
      responses.push(await POST(nodeRequest(`Pro node ${index}`, `sk-pro-secret-${index}-123456`)));
    }
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const list = await GET();
    const listBody = await list.json();
    const repo = await createProviderNodeRepository();
    const secretNode = await repo.getForAudit(bodies[0].node.id);
    await repo.close();
    const jobs = await createJobRepository();
    const initialHeartbeat = await jobs.claimNext({ workerId: "node-route-test", types: ["heartbeat"] });
    await jobs.close();
    const initialPayload = JSON.parse(initialHeartbeat?.payloadJson ?? "{}");
    const serialized = JSON.stringify({ bodies, listBody });

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 400]);
    expect(bodies[0].node).toMatchObject({
      name: "Pro node 0",
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-5.1",
      apiKeySuffix: "3456",
      heartbeatIntervalSeconds: 300,
      deepAuditIntervalSeconds: 43200,
      ttftThresholdMs: 750
    });
    expect(bodies[3].error).toBe("pro plan supports up to 3 active provider nodes");
    expect(listBody.nodes).toHaveLength(3);
    expect(listBody.nodes.find((node: { id: string }) => node.id === bodies[0].node.id).ttftThresholdMs).toBe(750);
    expect(initialHeartbeat?.type).toBe("heartbeat");
    expect(initialPayload).toMatchObject({
      source: "node-create",
      nodeId: bodies[0].node.id,
      fingerprint: `heartbeat:${bodies[0].node.id}:initial`
    });
    expect(listBody.nodes.find((node: { id: string }) => node.id === bodies[0].node.id).nextHeartbeatAt).toBeTruthy();
    expect(decryptSecret(secretNode!.encryptedApiKey!)).toBe("sk-pro-secret-0-123456");
    expect(serialized).not.toContain("sk-pro-secret");
    expect(serialized).not.toContain("encryptedApiKey");
  });

  it("allows Team node capacity and deletes key material on node removal", async () => {
    await createSession("team");

    const responses = [];
    for (let index = 0; index < 4; index += 1) {
      responses.push(await POST(nodeRequest(`Team node ${index}`, `sk-team-secret-${index}-123456`)));
    }
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const deleteResponse = await DELETE(
      new Request("http://localhost/api/workspace/nodes", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: bodies[0].node.id })
      })
    );
    const deleteBody = await deleteResponse.json();
    const list = await GET();
    const listBody = await list.json();
    const repo = await createProviderNodeRepository();
    const secretAfterDelete = await repo.getForAudit(bodies[0].node.id);
    await repo.close();

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    expect(bodies[0].node).toMatchObject({ heartbeatIntervalSeconds: 60, deepAuditIntervalSeconds: 21600 });
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toMatchObject({ deleted: true, nodeId: bodies[0].node.id });
    expect(listBody.nodes.map((node: { id: string }) => node.id)).not.toContain(bodies[0].node.id);
    expect(secretAfterDelete).toBeUndefined();
  });
});

async function createSession(tier: "free" | "pro" | "team") {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-workspace-nodes-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const email = `nodes-${tier}@example.com`;
    const login = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!login) throw new Error("failed to create test session");
    if (tier !== "free") {
      const billing = await createBillingRepository();
      try {
        await billing.updateWorkspaceBilling({ workspaceId: login.session.workspace.id, subscriptionStatus: "active", tier });
      } finally {
        await billing.close();
      }
    }
    const refreshed = await auth.consumeMagicLink((await auth.createMagicLink(email)).token);
    if (!refreshed) throw new Error("failed to refresh test session");
    cookieState.sessionToken = refreshed.sessionToken;
  } finally {
    await auth.close();
  }
}

function nodeRequest(name: string, apiKey: string) {
  return new Request("http://localhost/api/workspace/nodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-5.1",
      apiKey,
      heartbeatIntervalSeconds: 10,
      deepAuditIntervalSeconds: 3600,
      ttftThresholdMs: 750
    })
  });
}
