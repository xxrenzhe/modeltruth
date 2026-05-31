import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { createAuthRepository, createProviderNodeRepository, ensureSqliteReady } from "@modeltruth/db";
import { rotateProviderNodeApiKeys } from "./rotate-encryption-key";

describe("rotateProviderNodeApiKeys", () => {
  it("dry-runs and applies provider node API key ciphertext rotation", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "modeltruth-rotate-key-"));
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(dir, "modeltruth.sqlite");
    await ensureSqliteReady({ cwd: process.cwd(), databasePath: process.env.DATABASE_PATH });

    const auth = await createAuthRepository();
    const link = await auth.createMagicLink("rotate-script@example.com");
    const session = await auth.consumeMagicLink(link.token);
    await auth.close();

    const nodes = await createProviderNodeRepository();
    const node = await nodes.create({
      workspaceId: session!.session.workspace.id,
      name: "Rotate script target",
      baseUrl: "https://api.example.com/v1",
      baseUrlHostHash: "host_hash",
      modelId: "gpt-5.1",
      encryptedApiKey: encryptSecret("sk-script-rotate-123456", "old-key"),
      apiKeySuffix: getSecretSuffix("sk-script-rotate-123456")
    });
    await nodes.close();

    const dryRun = await rotateProviderNodeApiKeys({ oldKey: "old-key", newKey: "new-key", apply: false });
    const afterDryRunRepo = await createProviderNodeRepository();
    const afterDryRun = await afterDryRunRepo.getForAudit(node.id);
    await afterDryRunRepo.close();
    const applied = await rotateProviderNodeApiKeys({ oldKey: "old-key", newKey: "new-key", apply: true });
    const afterApplyRepo = await createProviderNodeRepository();
    const afterApply = await afterApplyRepo.getForAudit(node.id);
    await afterApplyRepo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(dryRun).toMatchObject({ scanned: 1, rotated: 1, failed: 0, mode: "dry-run" });
    expect(decryptSecret(afterDryRun!.encryptedApiKey!, "old-key")).toBe("sk-script-rotate-123456");
    expect(applied).toMatchObject({ scanned: 1, rotated: 1, failed: 0, mode: "apply" });
    expect(() => decryptSecret(afterApply!.encryptedApiKey!, "old-key")).toThrow();
    expect(decryptSecret(afterApply!.encryptedApiKey!, "new-key")).toBe("sk-script-rotate-123456");
  });
});
