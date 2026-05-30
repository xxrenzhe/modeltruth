import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { ensureSqliteReady } from "./index";
import { createAuthRepository } from "./auth";
import { createProviderNodeRepository } from "./provider-nodes";

describe("ProviderNodeRepository", () => {
  it("stores encrypted key material and returns only suffix", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-node-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd, databasePath: process.env.DATABASE_PATH });

    const authRepo = await createAuthRepository();
    const link = await authRepo.createMagicLink("node-owner@example.com");
    const sessionResult = await authRepo.consumeMagicLink(link.token);
    await authRepo.close();

    const repo = await createProviderNodeRepository();
    const node = await repo.create({
      workspaceId: sessionResult!.session.workspace.id,
      name: "Primary",
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "host_hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret("sk-test-node-123456", "test-key"),
      apiKeySuffix: getSecretSuffix("sk-test-node-123456")
    });
    const nodes = await repo.list(sessionResult!.session.workspace.id);
    const secretNode = await repo.getForAudit(node.id);
    const dueNodes = await repo.listDueForSchedule(new Date());
    await repo.markScheduled(node.id, "heartbeat", new Date(Date.now() + 60_000));
    const dueAfterHeartbeat = await repo.listDueForSchedule(new Date());
    await repo.close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(node.apiKeySuffix).toBe("3456");
    expect(JSON.stringify(nodes)).not.toContain("sk-test-node");
    expect(secretNode?.encryptedApiKey).toBeTruthy();
    expect(dueNodes.map((item) => item.id)).toContain(node.id);
    expect(dueAfterHeartbeat.map((item) => item.id)).toContain(node.id);
    expect(nodes).toHaveLength(1);
  });
});
