import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, createBillingRepository, createProviderNodeRepository, getEvidencePackage, ensureSqliteReady } from "@modeltruth/db";
import { encryptSecret } from "@modeltruth/crypto";
import { GET, POST as registerProbe } from "./app/api/workspace/probes/route";
import { POST as heartbeatProbe } from "./app/api/probes/heartbeat/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "", workspaceId: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("BYO probe API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    cookieState.workspaceId = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("lets Team workspaces register probes and receive token-authenticated heartbeats", async () => {
    await createSession("team");

    const registered = await registerProbe(jsonRequest({ name: "Tokyo Probe", region: "ap-northeast-1" }));
    const registeredBody = await registered.json();
    const node = await createNodeForWorkspace(cookieState.workspaceId);
    const heartbeat = await heartbeatProbe(
      new Request("http://localhost/api/probes/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${registeredBody.token}` },
        body: JSON.stringify({
          version: "0.1.0",
          result: {
            runId: "probe_run_1",
            nodeId: node.id,
            modelId: "gpt-5.1",
            status: "warning",
            confidence: 0.86,
            metrics: {
              statusCode: 200,
              ttftMs: 1200,
              rawEndpoint: "https://private-node.example.com/v1/chat/completions"
            },
            assertions: [{ id: "REGIONAL_LATENCY", status: "warning", prompt: "raw prompt should not be stored" }],
            evidenceSummary: {
              completionHash: "hash",
              apiKey: "sk-should-redact-123456",
              rawEndpoint: "https://private-node.example.com/v1/chat/completions",
              prompt: "raw prompt should not be stored",
              completion: "raw completion should not be stored",
              storedHeaders: {
                "content-type": "application/json",
                authorization: "Bearer sk-should-redact-123456",
                "x-private-routing": "private route"
              }
            }
          }
        })
      })
    );
    const heartbeatBody = await heartbeat.json();
    const listed = await GET();
    const listedBody = await listed.json();
    const evidence = await getEvidencePackage("probe_run_1");

    expect(registered.status).toBe(201);
    expect(registeredBody.token).toMatch(/^mtp_/);
    expect(JSON.stringify(registeredBody.probe)).not.toContain(registeredBody.token);
    expect(heartbeat.status).toBe(200);
    expect(heartbeatBody.probe).toMatchObject({ status: "active", version: "0.1.0", region: "ap-northeast-1" });
    expect(heartbeatBody.targets).toEqual([
      expect.objectContaining({ nodeId: node.id, baseUrl: "https://api.example.com/v1", modelId: "gpt-5.1" })
    ]);
    expect(JSON.stringify(heartbeatBody.targets)).not.toContain("encrypted");
    expect(JSON.stringify(heartbeatBody.targets)).not.toContain("sk-");
    expect(listedBody.probes[0]).toMatchObject({ name: "Tokyo Probe", status: "active" });
    expect(JSON.stringify(listedBody)).not.toContain(registeredBody.token);
    expect(evidence).toMatchObject({
      runId: "probe_run_1",
      runType: "externalProbe",
      nodeId: node.id,
      status: "warning"
    });
    expect(evidence?.evidenceSummary).toMatchObject({ externalProbe: true, probeRegion: "ap-northeast-1" });
    const serializedEvidence = JSON.stringify(evidence);
    expect(serializedEvidence).not.toContain("sk-should-redact");
    expect(serializedEvidence).not.toContain("private-node.example.com");
    expect(serializedEvidence).not.toContain("raw prompt should not be stored");
    expect(serializedEvidence).not.toContain("raw completion should not be stored");
    expect(serializedEvidence).not.toContain("x-private-routing");
  });

  it("blocks BYO probe registration for non-Team workspaces", async () => {
    await createSession("pro");

    const response = await registerProbe(jsonRequest({ name: "Blocked Probe", region: "us-east-1" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("BYO probe registration requires a Team subscription");
  });
});

async function createSession(tier: "pro" | "team") {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-byo-probe-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const auth = await createAuthRepository();
  try {
    const link = await auth.createMagicLink(`probe-${tier}@example.com`);
    const login = await auth.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create test session");
    const billing = await createBillingRepository();
    try {
      await billing.updateWorkspaceBilling({ workspaceId: login.session.workspace.id, subscriptionStatus: "active", tier });
    } finally {
      await billing.close();
    }
    const refreshedLink = await auth.createMagicLink(`probe-${tier}@example.com`);
    const refreshedLogin = await auth.consumeMagicLink(refreshedLink.token);
    if (!refreshedLogin) throw new Error("failed to refresh session");
    cookieState.sessionToken = refreshedLogin.sessionToken;
    cookieState.workspaceId = refreshedLogin.session.workspace.id;
  } finally {
    await auth.close();
  }
}

async function createNodeForWorkspace(workspaceId: string) {
  const repo = await createProviderNodeRepository();
  try {
    return await repo.create({
      workspaceId,
      name: "Probe target",
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret("sk-secret-for-server-only"),
      apiKeySuffix: "only"
    });
  } finally {
    await repo.close();
  }
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/workspace/probes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
