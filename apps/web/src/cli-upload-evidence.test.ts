import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSqliteReady, createAuthRepository, getEvidencePackage, listAuditRuns } from "@modeltruth/db";
import { POST as uploadCliReport } from "./app/api/cli/upload/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("CLI upload evidence persistence", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("requires login consent and persists uploaded CLI reports into Evidence Center", async () => {
    const session = await createLoggedInSession();
    const response = await uploadCliReport(
      jsonRequest({
        consent: true,
        schemaVersion: "modeltruth.report.v1",
        suiteId: "smoke@1.0.0",
        model: "gpt-5.1",
        status: "warning",
        confidence: 0.74,
        metrics: {
          statusCode: 200,
          totalLatencyMs: 1234,
          tokenUsage: { prompt: 10, completion: 2, total: 12, rawPrompt: "full prompt should not persist" }
        },
        assertions: [{ id: "USAGE_PRESENT", status: "warning", prompt: "redacted" }],
        evidenceSummary: {
          requestBodyStored: false,
          authorizationHeaderStored: false,
          storedHeaders: { "content-type": "application/json", authorization: "Bearer sk-cli-secret-123456" },
          completionHash: "hash-only",
          leakedSecret: "sk-cli-secret-123456",
          rawCompletion: "full completion should not persist"
        }
      })
    );
    const body = await response.json();
    const runs = await listAuditRuns({ workspaceId: session.workspace.id });
    const evidence = await getEvidencePackage(body.runId);

    expect(response.status).toBe(200);
    expect(body.uploaded).toBe(true);
    expect(runs.map((run) => run.runId)).toContain(body.runId);
    expect(evidence).toMatchObject({
      runId: body.runId,
      workspaceId: session.workspace.id,
      suiteId: "smoke",
      suiteVersion: "1.0.0",
      runType: "cli",
      targetModelId: "gpt-5.1",
      status: "warning"
    });
    expect(JSON.stringify(evidence)).not.toContain("sk-cli-secret");
    expect(JSON.stringify(evidence)).not.toContain("full completion should not persist");
    expect(JSON.stringify(evidence)).not.toContain("full prompt should not persist");
  });

  it("rejects CLI uploads without explicit consent", async () => {
    await createLoggedInSession();

    const response = await uploadCliReport(jsonRequest({ consent: false }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("consent=true is required");
  });

  it("rejects unregistered CLI upload suites before persisting evidence", async () => {
    const session = await createLoggedInSession();

    const response = await uploadCliReport(jsonRequest({ consent: true, suiteId: "unknown-suite@1.0.0", status: "warning" }));
    const body = await response.json();
    const runs = await listAuditRuns({ workspaceId: session.workspace.id });

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unsupported audit suite: unknown-suite@1.0.0");
    expect(runs).toHaveLength(0);
  });
});

async function createLoggedInSession() {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-cli-upload-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
  const repo = await createAuthRepository();
  try {
    const link = await repo.createMagicLink("cli-user@example.com");
    const login = await repo.consumeMagicLink(link.token);
    if (!login) throw new Error("failed to create test session");
    cookieState.sessionToken = login.sessionToken;
    return login.session;
  } finally {
    await repo.close();
  }
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/cli/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}
