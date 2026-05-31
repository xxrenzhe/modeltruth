import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRepository, ensureSqliteReady, getEvidencePackage, saveAuditRun } from "@modeltruth/db";
import { GET as listEvidence } from "./app/api/evidence/route";
import { DELETE as deleteEvidence, GET as exportEvidence } from "./app/api/evidence/[runId]/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("Evidence export API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires authentication", async () => {
    await setupDatabase();

    const listResponse = await listEvidence(new Request("http://localhost/api/evidence"));
    const exportResponse = await exportEvidence(new Request("http://localhost/api/evidence/run_export"), {
      params: Promise.resolve({ runId: "run_export" })
    });

    expect(listResponse.status).toBe(401);
    expect(exportResponse.status).toBe(401);
  });

  it("lists only same-workspace evidence and keeps public summary anonymous", async () => {
    const session = await createLoggedInSession("evidence-list@example.com");
    await seedEvidence("run_visible", session.workspace.id);
    await seedEvidence("run_hidden", "ws_other");

    const privateResponse = await listEvidence(new Request("http://localhost/api/evidence"));
    const publicResponse = await listEvidence(new Request("http://localhost/api/evidence?scope=public"));
    const privateBody = await privateResponse.json();
    const publicBody = await publicResponse.json();

    expect(privateResponse.status).toBe(200);
    expect(privateBody.runs.map((run: { runId: string }) => run.runId)).toContain("run_visible");
    expect(privateBody.runs.map((run: { runId: string }) => run.runId)).not.toContain("run_hidden");
    expect(publicResponse.status).toBe(200);
    expect(JSON.stringify(publicBody)).not.toContain(session.workspace.id);
    expect(JSON.stringify(publicBody)).not.toContain("ws_other");
  });

  it("exports same-workspace JSON evidence without secrets or full prompt and completion", async () => {
    const session = await createLoggedInSession("evidence-owner@example.com");
    await seedEvidence("run_export", session.workspace.id);

    const response = await exportEvidence(new Request("http://localhost/api/evidence/run_export"), {
      params: Promise.resolve({ runId: "run_export" })
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.evidence).toMatchObject({
      runId: "run_export",
      workspaceId: session.workspace.id,
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "deepAudit",
      status: "warning"
    });
    expect(body.evidence.metrics.tokenUsage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
    expect(body.evidence.evidenceSummary.completionHash).toBe("hash-only");
    expect(body.evidence.evidenceSummary.usage).toEqual({ totalTokens: 12 });
    expect(serialized).not.toContain("total_tokens");
    expect(serialized).not.toContain("sk-export-secret");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("full prompt should not export");
    expect(serialized).not.toContain("full completion should not export");
  });

  it("hides other workspace evidence as not found", async () => {
    await createLoggedInSession("evidence-viewer@example.com");
    await seedEvidence("run_other_workspace", "ws_other");

    const response = await exportEvidence(new Request("http://localhost/api/evidence/run_other_workspace"), {
      params: Promise.resolve({ runId: "run_other_workspace" })
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("evidence not found");
  });

  it("allows users to delete only their own evidence", async () => {
    const session = await createLoggedInSession("evidence-delete@example.com");
    await seedEvidence("run_delete", session.workspace.id);
    await seedEvidence("run_delete_other", "ws_other");

    const forbidden = await deleteEvidence(new Request("http://localhost/api/evidence/run_delete_other"), {
      params: Promise.resolve({ runId: "run_delete_other" })
    });
    const deleted = await deleteEvidence(new Request("http://localhost/api/evidence/run_delete"), {
      params: Promise.resolve({ runId: "run_delete" })
    });
    const deletedBody = await deleted.json();

    expect(forbidden.status).toBe(404);
    expect(deleted.status).toBe(200);
    expect(deletedBody).toEqual({ deleted: true, runId: "run_delete" });
    expect(await getEvidencePackage("run_delete")).toBeUndefined();
    expect(await getEvidencePackage("run_delete_other")).toBeTruthy();
  });
});

async function createLoggedInSession(email: string) {
  await setupDatabase();
  const repo = await createAuthRepository();
  try {
    const link = await repo.createMagicLink(email);
    const login = await repo.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create test session");
    cookieState.sessionToken = login.sessionToken;
    return login.session;
  } finally {
    await repo.close();
  }
}

async function setupDatabase() {
  if (!tempDir) {
    tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-evidence-export-api-"));
    previousDatabasePath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  }
  const databasePath = process.env.DATABASE_PATH;
  if (!databasePath) throw new Error("DATABASE_PATH was not initialized");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath });
}

async function seedEvidence(runId: string, workspaceId: string) {
  await saveAuditRun({
    id: runId,
    workspaceId,
    providerSlug: "openai",
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType: "deepAudit",
    targetModelId: "gpt-5.1",
    status: "warning",
    confidence: 0.73,
    metrics: {
      statusCode: 200,
      totalLatencyMs: 1200,
      tokenUsage: { prompt: 10, completion: 2, total: 12, rawPrompt: "full prompt should not export" },
      apiKey: "sk-export-secret-123456"
    },
    assertions: [{ id: "USAGE_PRESENT", status: "warning", prompt: "full prompt should not export" }],
    evidenceSummary: {
      requestBodyStored: false,
      authorizationHeaderStored: false,
      completionHash: "hash-only",
      usage: { total_tokens: 12 },
      responseExcerpt: "short public diagnostic excerpt",
      storedHeaders: { authorization: "Bearer sk-export-secret-123456" },
      rawCompletion: "full completion should not export",
      leakedSecret: "sk-export-secret-123456"
    }
  });
}
