import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, getSecretSuffix } from "@modeltruth/crypto";
import { createAlertChannelRepository, createAuthRepository, createProviderNodeRepository, ensureSqliteReady } from "@modeltruth/db";
import { rotateProviderNodeApiKeys } from "./rotate-encryption-key";

describe("rotateProviderNodeApiKeys", () => {
  it("dry-runs and applies encrypted provider API key and alert target rotation", async () => {
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
    const channels = await createAlertChannelRepository();
    const channel = await channels.create({
      workspaceId: session!.session.workspace.id,
      type: "webhook",
      encryptedTarget: encryptSecret("https://hooks.example.com/modeltruth-secret", "old-key"),
      targetSuffix: "truth-secret"
    });
    await channels.close();

    const dryRun = await rotateProviderNodeApiKeys({ oldKey: "old-key", newKey: "new-key", apply: false });
    const afterDryRunRepo = await createProviderNodeRepository();
    const afterDryRun = await afterDryRunRepo.getForAudit(node.id);
    await afterDryRunRepo.close();
    const channelAfterDryRunRepo = await createAlertChannelRepository();
    const channelAfterDryRun = (await channelAfterDryRunRepo.listEnabledSecrets(session!.session.workspace.id)).find(
      (item) => item.id === channel.id
    );
    await channelAfterDryRunRepo.close();
    const applied = await rotateProviderNodeApiKeys({ oldKey: "old-key", newKey: "new-key", apply: true });
    const afterApplyRepo = await createProviderNodeRepository();
    const afterApply = await afterApplyRepo.getForAudit(node.id);
    await afterApplyRepo.close();
    const channelAfterApplyRepo = await createAlertChannelRepository();
    const channelAfterApply = (await channelAfterApplyRepo.listEnabledSecrets(session!.session.workspace.id)).find(
      (item) => item.id === channel.id
    );
    await channelAfterApplyRepo.close();

    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });

    expect(dryRun).toMatchObject({
      scanned: 2,
      rotated: 2,
      failed: 0,
      mode: "dry-run",
      assets: {
        providerNodeApiKeys: { scanned: 1, rotated: 1, failed: 0 },
        alertChannelTargets: { scanned: 1, rotated: 1, failed: 0 }
      }
    });
    expect(decryptSecret(afterDryRun!.encryptedApiKey!, "old-key")).toBe("sk-script-rotate-123456");
    expect(decryptSecret(channelAfterDryRun!.encryptedTarget, "old-key")).toBe("https://hooks.example.com/modeltruth-secret");
    expect(applied).toMatchObject({
      scanned: 2,
      rotated: 2,
      failed: 0,
      mode: "apply",
      assets: {
        providerNodeApiKeys: { scanned: 1, rotated: 1, failed: 0 },
        alertChannelTargets: { scanned: 1, rotated: 1, failed: 0 }
      }
    });
    expect(() => decryptSecret(afterApply!.encryptedApiKey!, "old-key")).toThrow();
    expect(decryptSecret(afterApply!.encryptedApiKey!, "new-key")).toBe("sk-script-rotate-123456");
    expect(() => decryptSecret(channelAfterApply!.encryptedTarget, "old-key")).toThrow();
    expect(decryptSecret(channelAfterApply!.encryptedTarget, "new-key")).toBe("https://hooks.example.com/modeltruth-secret");
  });
});
