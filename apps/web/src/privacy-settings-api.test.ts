import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAlertChannelRepository,
  createAuthRepository,
  createProviderNodeRepository,
  ensureSqliteReady,
  saveAuditRun
} from "@modeltruth/db";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { GET, PATCH } from "./app/api/settings/privacy/route";
import { POST as DELETE_ACCOUNT } from "./app/api/settings/privacy/delete/route";
import { GET as EXPORT_PRIVACY } from "./app/api/settings/privacy/export/route";

const cookieState = vi.hoisted(() => ({ sessionToken: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "mt_session" ? { value: cookieState.sessionToken } : undefined)
  })
}));

let previousDatabasePath: string | undefined;
let tempDir: string | undefined;

describe("privacy settings API", () => {
  afterEach(() => {
    cookieState.sessionToken = "";
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    vi.restoreAllMocks();
  });

  it("returns default evidence privacy settings and persists explicit opt-in", async () => {
    await createLoggedInSession();

    const initial = await GET();
    const initialBody = await initial.json();
    const update = await PATCH(jsonRequest({ saveFullResponses: true }));
    const updateBody = await update.json();
    const refreshed = await GET();
    const refreshedBody = await refreshed.json();

    expect(initialBody.settings.saveFullResponses).toBe(false);
    expect(update.status).toBe(200);
    expect(updateBody.settings.saveFullResponses).toBe(true);
    expect(refreshedBody.settings.saveFullResponses).toBe(true);
  });

  it("rejects non-boolean evidence privacy updates", async () => {
    await createLoggedInSession();

    const response = await PATCH(jsonRequest({ saveFullResponses: "yes" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("saveFullResponses must be boolean");
  });

  it("requires authentication before exporting or deleting privacy data", async () => {
    const exportResponse = await EXPORT_PRIVACY();
    const deleteResponse = await DELETE_ACCOUNT();

    expect(exportResponse.status).toBe(401);
    expect(await exportResponse.json()).toMatchObject({ error: "authentication required" });
    expect(deleteResponse.status).toBe(401);
    expect(await deleteResponse.json()).toMatchObject({ error: "authentication required" });
  });

  it("exports privacy data through the route without secrets or full responses", async () => {
    const session = await createLoggedInSession("privacy-export-route@example.com");
    await createPrivacyExportFixtures(session.workspace.id);

    const response = await EXPORT_PRIVACY();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.schemaVersion).toBe("modeltruth.privacy-export.v1");
    expect(body.export.user.email).toBe("privacy-export-route@example.com");
    expect(body.export.providerNodes[0]).toMatchObject({ apiKeySuffix: "cret" });
    expect(body.export.alertChannels[0]).toMatchObject({ type: "webhook", targetSuffix: "hooks.example.com" });
    expect(body.export.auditRuns[0]).toMatchObject({ runId: "privacy_route_run" });
    expect(serialized).not.toContain("sk-route-secret");
    expect(serialized).not.toContain("hooks.example.com/private");
    expect(serialized).not.toContain("private completion body");
  });

  it("deletes the account through the route and invalidates the session", async () => {
    const session = await createLoggedInSession("privacy-delete-route@example.com");
    await createPrivacyExportFixtures(session.workspace.id);

    const response = await DELETE_ACCOUNT();
    const body = await response.json();
    const exportAfterDelete = await EXPORT_PRIVACY();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: true });
    expect(response.headers.get("set-cookie")).toContain("mt_session=");
    expect(exportAfterDelete.status).toBe(401);
    expect(await exportAfterDelete.json()).toMatchObject({ error: "authentication required" });
  });
});

async function createLoggedInSession(email = "privacy-settings@example.com") {
  tempDir = mkdtempSync(path.join(tmpdir(), "modeltruth-privacy-settings-api-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "modeltruth.sqlite");
  await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });
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

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/settings/privacy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function createPrivacyExportFixtures(workspaceId: string) {
  const nodes = await createProviderNodeRepository();
  const node = await nodes.create({
    workspaceId,
    name: "Privacy route node",
    baseUrl: "https://api.example.com/v1",
    baseUrlHostHash: "host_hash",
    modelId: "gpt-5.1",
    encryptedApiKey: encryptSecret("sk-route-secret"),
    apiKeySuffix: getSecretSuffix("sk-route-secret")
  });
  await nodes.close();

  const alerts = await createAlertChannelRepository();
  await alerts.create({
    workspaceId,
    type: "webhook",
    encryptedTarget: encryptSecret("https://hooks.example.com/private"),
    targetSuffix: "hooks.example.com"
  });
  await alerts.close();

  await saveAuditRun({
    id: "privacy_route_run",
    workspaceId,
    nodeId: node.id,
    suiteId: "smoke",
    suiteVersion: "1.0.0",
    runType: "deepAudit",
    targetModelId: "gpt-5.1",
    status: "pass",
    confidence: 0.9,
    metrics: { ttftMs: 100 },
    assertions: [],
    evidenceSummary: { fullResponse: "private completion body", responseBodyStored: true }
  });
}
