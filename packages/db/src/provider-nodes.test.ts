import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { ensureSqliteReady } from "./index";
import { createProviderNodeRepository } from "./provider-nodes";

describe("ProviderNodeRepository", () => {
  it("stores encrypted key material and returns only suffix", async () => {
    const cwd = process.cwd();
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-node-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd, databasePath: process.env.DATABASE_PATH });

    const repo = await createProviderNodeRepository();
    const node = await repo.create({
      workspaceId: "workspace_test",
      name: "Primary",
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "host_hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret("sk-test-node-123456", "test-key"),
      apiKeySuffix: getSecretSuffix("sk-test-node-123456")
    });
    const nodes = await repo.list("workspace_test");
    await repo.close();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(node.apiKeySuffix).toBe("3456");
    expect(JSON.stringify(nodes)).not.toContain("sk-test-node");
    expect(nodes).toHaveLength(1);
  });
});
