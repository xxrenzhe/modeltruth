import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { createAlertChannelRepository } from "./alert-channels";
import { saveAuditRun } from "./audit-runs";
import { createJobRepository } from "./jobs";
import { createProviderNodeRepository } from "./provider-nodes";
import { createProviderSubscriptionRepository } from "./provider-subscriptions";

describe("AuthRepository", () => {
  it("creates a workspace-backed session from a single-use magic link", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-auth-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createAuthRepository();
    const link = await repo.createMagicLink("User@Example.com", 60);
    const result = await repo.consumeMagicLink(link.token);
    const secondResult = await repo.consumeMagicLink(link.token);
    const session = result ? await repo.getSession(result.sessionToken) : undefined;
    const exported = session ? await repo.exportUserData(session.user.id) : undefined;
    if (result) await repo.destroySession(result.sessionToken);
    const destroyed = result ? await repo.getSession(result.sessionToken) : undefined;
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(link.email).toBe("user@example.com");
    expect(result?.session.user.email).toBe("user@example.com");
    expect(result?.session.workspace.id).toBeTruthy();
    expect(secondResult).toBeUndefined();
    expect(session?.workspace.id).toBe(result?.session.workspace.id);
    expect(exported?.user.email).toBe("user@example.com");
    expect(exported?.workspaces[0].id).toBe(result?.session.workspace.id);
    expect(exported?.workspaceMemberships[0]).toMatchObject({ role: "owner", status: "active" });
    expect(destroyed).toBeUndefined();
  });

  it("exports privacy data categories without secrets or full response bodies", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-auth-privacy-export-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createAuthRepository();
    const link = await repo.createMagicLink("privacy-export@example.com", 60);
    const result = await repo.consumeMagicLink(link.token);
    const workspaceId = result!.session.workspace.id;
    const nodes = await createProviderNodeRepository();
    const node = await nodes.create({
      workspaceId,
      name: "Private node",
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "host_hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret("sk-export-secret"),
      apiKeySuffix: getSecretSuffix("sk-export-secret")
    });
    await nodes.close();
    const alerts = await createAlertChannelRepository();
    await alerts.create({
      workspaceId,
      type: "webhook",
      encryptedTarget: encryptSecret("https://hooks.example.com/secret"),
      targetSuffix: "hooks.example.com"
    });
    await alerts.close();
    await saveAuditRun({
      id: "run_export",
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
      evidenceSummary: {
        fullResponse: "private completion",
        responseBodyStored: true,
        responseMetadata: { usage: { total_tokens: 12 } }
      }
    });
    const exported = await repo.exportUserData(result!.session.user.id);
    await repo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(exported?.providerNodes[0]).toMatchObject({ id: node.id, apiKeySuffix: "cret" });
    expect(exported?.alertChannels[0]).toMatchObject({ type: "webhook", targetSuffix: "hooks.example.com" });
    expect(exported?.auditRuns[0]).toMatchObject({ runId: "run_export", metrics: { ttftMs: 100 } });
    expect(exported?.auditRuns[0].evidenceSummary).toMatchObject({ responseMetadata: { usage: { totalTokens: 12 } } });
    expect(JSON.stringify(exported)).not.toContain("total_tokens");
    expect(JSON.stringify(exported)).not.toContain("sk-export-secret");
    expect(JSON.stringify(exported)).not.toContain("hooks.example.com/secret");
    expect(JSON.stringify(exported)).not.toContain("private completion");
  });

  it("deletes user account sessions and workspace identity", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-auth-delete-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const repo = await createAuthRepository();
    const link = await repo.createMagicLink("delete@example.com", 60);
    const result = await repo.consumeMagicLink(link.token);
    const workspaceId = result!.session.workspace.id;
    await createDeleteFixtures(workspaceId);
    const deleted = result ? await repo.deleteUserAccount(result.session.user.id) : false;
    const session = result ? await repo.getSession(result.sessionToken) : undefined;
    const exported = result ? await repo.exportUserData(result.session.user.id) : undefined;
    await repo.close();
    const residual = countDeleteResiduals(process.env.DATABASE_PATH, workspaceId, "delete@example.com");

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(deleted).toBe(true);
    expect(session).toBeUndefined();
    expect(exported).toBeUndefined();
    expect(residual).toEqual({
      users: 0,
      workspaces: 0,
      providerNodesWithKeyMaterial: 0,
      alertChannels: 0,
      providerSubscriptions: 0,
      jobsWithWorkspacePayload: 0
    });
  });
});

async function createDeleteFixtures(workspaceId: string) {
  const nodes = await createProviderNodeRepository();
  await nodes.create({
    workspaceId,
    name: "Delete target",
    baseUrl: "https://api.example.com/v1",
    baseUrlHostHash: "host_hash",
    modelId: "gpt-5.1",
    encryptedApiKey: encryptSecret("sk-delete-secret"),
    apiKeySuffix: getSecretSuffix("sk-delete-secret")
  });
  await nodes.close();

  const alerts = await createAlertChannelRepository();
  await alerts.create({
    workspaceId,
    type: "webhook",
    encryptedTarget: encryptSecret("https://hooks.example.com/delete-secret"),
    targetSuffix: "hooks.example.com"
  });
  await alerts.close();

  const subscriptions = await createProviderSubscriptionRepository();
  await subscriptions.create({ providerSlug: "openrouter", email: "delete@example.com", notificationType: "risk_trend" });
  await subscriptions.close();

  const jobs = await createJobRepository();
  await jobs.enqueue({ type: "deepAudit", payload: { workspaceId, apiKey: "sk-delete-secret" } });
  await jobs.close();
}

function countDeleteResiduals(databasePath: string, workspaceId: string, email: string) {
  const db = new DatabaseSync(databasePath);
  try {
    return {
      users: count(db, "select count(*) as count from users where email = ?", email),
      workspaces: count(db, "select count(*) as count from workspaces where id = ?", workspaceId),
      providerNodesWithKeyMaterial: count(
        db,
        "select count(*) as count from provider_nodes where workspace_id = ? and (encrypted_api_key is not null or api_key_suffix is not null)",
        workspaceId
      ),
      alertChannels: count(db, "select count(*) as count from alert_channels where workspace_id = ?", workspaceId),
      providerSubscriptions: count(db, "select count(*) as count from provider_subscriptions where email = ?", email),
      jobsWithWorkspacePayload: count(db, "select count(*) as count from jobs where payload_json like ?", `%"workspaceId":"${workspaceId}"%`)
    };
  } finally {
    db.close();
  }
}

function count(db: DatabaseSync, sql: string, param: string) {
  return (db.prepare(sql).get(param) as { count: number }).count;
}
