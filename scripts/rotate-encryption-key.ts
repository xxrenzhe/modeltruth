import { decryptSecret, encryptSecret } from "@modeltruth/crypto";
import { createProviderNodeRepository, ensureDatabaseReady, type ProviderNodeKeyRotationRecord } from "@modeltruth/db";
import { getAppConfig } from "@modeltruth/config";

export interface RotateEncryptionKeyOptions {
  oldKey: string;
  newKey: string;
  apply: boolean;
  limit?: number;
}

export interface RotateEncryptionKeyResult {
  scanned: number;
  rotated: number;
  failed: number;
  mode: "dry-run" | "apply";
  failures: Array<{ nodeId: string; reason: string }>;
}

export async function rotateProviderNodeApiKeys(options: RotateEncryptionKeyOptions): Promise<RotateEncryptionKeyResult> {
  if (!options.oldKey) throw new Error("oldKey is required");
  if (!options.newKey) throw new Error("newKey is required");
  if (options.oldKey === options.newKey) throw new Error("oldKey and newKey must differ");

  await ensureDatabaseReady();
  const repo = await createProviderNodeRepository();
  const failures: RotateEncryptionKeyResult["failures"] = [];
  let rotated = 0;
  try {
    const nodes = await repo.listKeysForRotation(options.limit);
    for (const node of nodes) {
      try {
        const plaintext = decryptSecret(node.encryptedApiKey, options.oldKey);
        if (node.apiKeySuffix && !plaintext.endsWith(node.apiKeySuffix)) {
          throw new Error("decrypted key suffix did not match stored suffix");
        }
        if (options.apply) {
          const updated = await repo.updateEncryptedApiKey(node.id, encryptSecret(plaintext, options.newKey));
          if (!updated) throw new Error("row was not updated");
        }
        rotated += 1;
      } catch (error) {
        failures.push({ nodeId: node.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { scanned: nodes.length, rotated, failed: failures.length, mode: options.apply ? "apply" : "dry-run", failures };
  } finally {
    await repo.close();
  }
}

if (process.argv[1]?.endsWith("scripts/rotate-encryption-key.ts")) {
  const result = await rotateProviderNodeApiKeys(readOptionsFromEnv(process.argv.slice(2)));
  console.log(
    `[rotate-encryption-key] mode=${result.mode} scanned=${result.scanned} rotated=${result.rotated} failed=${result.failed}`
  );
  for (const failure of result.failures) {
    console.error(`[rotate-encryption-key] failed node=${failure.nodeId}: ${failure.reason}`);
  }
  if (result.failed > 0) process.exit(1);
}

function readOptionsFromEnv(args: string[]): RotateEncryptionKeyOptions {
  const config = getAppConfig();
  return {
    oldKey: process.env.OLD_SECRET_ENCRYPTION_KEY ?? config.encryptionKey,
    newKey: process.env.NEW_SECRET_ENCRYPTION_KEY ?? "",
    apply: args.includes("--apply") || process.env.ROTATE_ENCRYPTION_KEY_APPLY === "1",
    limit: parseLimit(process.env.ROTATE_ENCRYPTION_KEY_LIMIT)
  };
}

function parseLimit(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
