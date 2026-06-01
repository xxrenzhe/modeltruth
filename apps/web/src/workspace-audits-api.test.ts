import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthRepository,
  createBillingRepository,
  createJobRepository,
  createProviderNodeRepository,
  ensureSqliteReady,
  type AuthSession
} from "@modeltruth/db";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { POST } from "./app/api/workspace/audits/route";
import { traceIdFromRequestId } from "./lib/request-trace";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("workspace audits API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication", async () => {
    const response = await POST(auditRequest("node_missing", "billing-lite@1.0.0"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("authentication required");
  });

  it("blocks Free workspaces from manual private audits", async () => {
    const { node } = await createSessionWithNode("free");

    const response = await POST(auditRequest(node.id, "billing-lite@1.0.0", "req-workspace-audit-123456"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("manual workspace audits require a Pro or Team subscription");
  });

  it("enqueues billing-lite for a Pro workspace node without exposing secret material", async () => {
    const { session, node } = await createSessionWithNode("pro");

    const response = await POST(auditRequest(node.id, "billing-lite@1.0.0", "req-workspace-audit-123456"));
    const body = await response.json();
    const jobs = await createJobRepository();
    const claimed = await jobs.claimNext({ workerId: "workspace-audit-test", types: ["deepAudit"] });
    await jobs.close();
    const payload = JSON.parse(claimed?.payloadJson ?? "{}");
    const serialized = JSON.stringify({ body, payload });

    expect(response.status).toBe(201);
    expect(body.audit).toMatchObject({
      status: "queued",
      nodeId: node.id,
      suiteId: "billing-lite@1.0.0",
      duplicate: false
    });
    expect(payload).toMatchObject({
      source: "workspace-manual",
      workspaceId: session.workspace.id,
      nodeId: node.id,
      suiteId: "billing-lite@1.0.0",
      requestedByUserId: session.user.id,
      requestId: "req-workspace-audit-123456",
      traceId: traceIdFromRequestId("req-workspace-audit-123456"),
      fingerprint: `manual:${session.workspace.id}:${node.id}:billing-lite@1.0.0`
    });
    expect(serialized).not.toContain("sk-pro-secret");
    expect(serialized).not.toContain("encryptedApiKey");
  });

  it("rejects nodes outside the current workspace", async () => {
    const first = await createSessionWithNode("pro", "owner-one@example.com");
    const second = await createSessionWithNode("pro", "owner-two@example.com", { keepDatabase: true });
    cookieState.sessionToken = first.sessionToken;

    const response = await POST(auditRequest(second.node.id, "billing-lite@1.0.0"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("node not found");
  });

  it("rejects unregistered or non-manual suites before enqueueing", async () => {
    const { node } = await createSessionWithNode("team");

    const unknown = await POST(auditRequest(node.id, "unknown-suite@1.0.0"));
    const calibration = await POST(auditRequest(node.id, "fingerprint-calibration@1.0.0"));
    const jobs = await createJobRepository();
    const claimed = await jobs.claimNext({ workerId: "workspace-audit-test", types: ["deepAudit"] });
    await jobs.close();

    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("Unsupported audit suite: unknown-suite@1.0.0");
    expect(calibration.status).toBe(400);
    expect((await calibration.json()).error).toBe("suite is not available for manual workspace audits");
    expect(claimed).toBeUndefined();
  });

  it("deduplicates active manual jobs by workspace, node and suite", async () => {
    const { node } = await createSessionWithNode("team");

    const first = await POST(auditRequest(node.id, "context-lite@1.0.0"));
    const second = await POST(auditRequest(node.id, "context-lite@1.0.0"));
    const jobs = await createJobRepository();
    const claimed = await jobs.claimNext({ workerId: "workspace-audit-test", types: ["deepAudit"] });
    const duplicate = await jobs.claimNext({ workerId: "workspace-audit-test", types: ["deepAudit"] });
    await jobs.close();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).audit).toMatchObject({ status: "alreadyQueued", duplicate: true });
    expect(claimed).toBeTruthy();
    expect(duplicate).toBeUndefined();
  });

  it("rate limits Pro manual audits across nodes in a short window", async () => {
    const { session, node } = await createSessionWithNode("pro");
    const nodes = [node, ...(await createAdditionalNodes(session.workspace.id, "pro-limit", 6))];

    for (const candidate of nodes.slice(0, 6)) {
      const response = await POST(auditRequest(candidate.id, "smoke@1.0.0"));
      expect(response.status).toBe(201);
      expect(response.headers.get("x-ratelimit-limit")).toBe("6");
    }

    const limited = await POST(auditRequest(nodes[6].id, "smoke@1.0.0"));
    const body = await limited.json();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-ratelimit-limit")).toBe("6");
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(limited.headers.get("retry-after")).toBe("600");
    expect(body.error).toBe("manual audit rate limit exceeded");
  });

  it("allows Team workspaces beyond the Pro manual audit limit", async () => {
    const { session, node } = await createSessionWithNode("team");
    const nodes = [node, ...(await createAdditionalNodes(session.workspace.id, "team-limit", 6))];

    const responses = [];
    for (const candidate of nodes) {
      responses.push(await POST(auditRequest(candidate.id, "reasoning-lite@1.0.0")));
    }

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201, 201, 201]);
    expect(responses.at(-1)?.headers.get("x-ratelimit-limit")).toBe("20");
    expect(responses.at(-1)?.headers.get("x-ratelimit-remaining")).toBe("13");
  });

  it("does not spend additional quota on duplicate active manual audits", async () => {
    const { session, node } = await createSessionWithNode("pro");
    const nodes = [node, ...(await createAdditionalNodes(session.workspace.id, "duplicate-quota", 5))];

    for (const candidate of nodes) {
      expect((await POST(auditRequest(candidate.id, "context-lite@1.0.0"))).status).toBe(201);
    }
    const duplicate = await POST(auditRequest(node.id, "context-lite@1.0.0"));
    const body = await duplicate.json();

    expect(duplicate.status).toBe(200);
    expect(duplicate.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(body.audit).toMatchObject({ status: "alreadyQueued", duplicate: true });
  });
});

async function createSessionWithNode(
  tier: "free" | "pro" | "team",
  email = `workspace-audit-${tier}@example.com`,
  options: { keepDatabase?: boolean } = {}
) {
  if (!options.keepDatabase) {
    tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-workspace-audits-api-"));
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  }
  const session = await createSession(tier, email);
  const nodes = await createProviderNodeRepository();
  try {
    const node = await nodes.create({
      workspaceId: session.workspace.id,
      name: `${tier} node`,
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "host-hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret(`sk-${tier}-secret-123456`),
      apiKeySuffix: getSecretSuffix(`sk-${tier}-secret-123456`),
      heartbeatIntervalSeconds: 300,
      deepAuditIntervalSeconds: 43200,
      ttftThresholdMs: 3000
    });
    return { session, sessionToken: cookieState.sessionToken, node };
  } finally {
    await nodes.close();
  }
}

async function createSession(tier: "free" | "pro" | "team", email: string): Promise<AuthSession> {
  const auth = await createAuthRepository();
  try {
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
    return refreshed.session;
  } finally {
    await auth.close();
  }
}

async function createAdditionalNodes(workspaceId: string, label: string, count: number) {
  const nodes = await createProviderNodeRepository();
  try {
    return await Promise.all(
      Array.from({ length: count }, (_, index) =>
        nodes.create({
          workspaceId,
          name: `${label} node ${index + 1}`,
          baseUrl: `https://api-${label}-${index + 1}.example.com/v1`,
          baseUrlHostHash: `${label}-host-hash-${index + 1}`,
          modelId: "gpt-5.1",
          encryptedApiKey: encryptSecret(`sk-${label}-${index + 1}-secret-123456`),
          apiKeySuffix: getSecretSuffix(`sk-${label}-${index + 1}-secret-123456`),
          heartbeatIntervalSeconds: 300,
          deepAuditIntervalSeconds: 43200,
          ttftThresholdMs: 3000
        })
      )
    );
  } finally {
    await nodes.close();
  }
}

function auditRequest(nodeId: string, suiteId: string, requestId?: string) {
  return new Request("http://localhost/api/workspace/audits", {
    method: "POST",
    headers: { "content-type": "application/json", ...(requestId ? { "x-request-id": requestId } : {}) },
    body: JSON.stringify({ nodeId, suiteId })
  });
}
