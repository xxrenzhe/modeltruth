import { decryptSecret, encryptSecret } from "@modeltruth/crypto";
import { createAlertChannelRepository, createProviderNodeRepository, ensureDatabaseReady } from "@modeltruth/db";
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
  assets: {
    providerNodeApiKeys: { scanned: number; rotated: number; failed: number };
    alertChannelTargets: { scanned: number; rotated: number; failed: number };
  };
  failures: Array<{ assetType: "providerNodeApiKey" | "alertChannelTarget"; assetId: string; reason: string }>;
}

export async function rotateEncryptedSecrets(options: RotateEncryptionKeyOptions): Promise<RotateEncryptionKeyResult> {
  if (!options.oldKey) throw new Error("oldKey is required");
  if (!options.newKey) throw new Error("newKey is required");
  if (options.oldKey === options.newKey) throw new Error("oldKey and newKey must differ");

  await ensureDatabaseReady();
  const nodes = await createProviderNodeRepository();
  const channels = await createAlertChannelRepository();
  const failures: RotateEncryptionKeyResult["failures"] = [];
  try {
    const providerNodes = await nodes.listKeysForRotation(options.limit);
    const alertChannels = await channels.listTargetsForRotation(options.limit);
    let rotatedProviderNodes = 0;
    let rotatedAlertChannels = 0;

    for (const node of providerNodes) {
      try {
        const plaintext = decryptSecret(node.encryptedApiKey, options.oldKey);
        if (node.apiKeySuffix && !plaintext.endsWith(node.apiKeySuffix)) {
          throw new Error("decrypted key suffix did not match stored suffix");
        }
        if (options.apply) {
          const updated = await nodes.updateEncryptedApiKey(node.id, encryptSecret(plaintext, options.newKey));
          if (!updated) throw new Error("row was not updated");
        }
        rotatedProviderNodes += 1;
      } catch (error) {
        failures.push({ assetType: "providerNodeApiKey", assetId: node.id, reason: errorMessage(error) });
      }
    }

    for (const channel of alertChannels) {
      try {
        const plaintext = decryptSecret(channel.encryptedTarget, options.oldKey);
        if (options.apply) {
          const updated = await channels.updateEncryptedTarget(channel.id, encryptSecret(plaintext, options.newKey));
          if (!updated) throw new Error("row was not updated");
        }
        rotatedAlertChannels += 1;
      } catch (error) {
        failures.push({ assetType: "alertChannelTarget", assetId: channel.id, reason: errorMessage(error) });
      }
    }

    return {
      scanned: providerNodes.length + alertChannels.length,
      rotated: rotatedProviderNodes + rotatedAlertChannels,
      failed: failures.length,
      mode: options.apply ? "apply" : "dry-run",
      assets: {
        providerNodeApiKeys: {
          scanned: providerNodes.length,
          rotated: rotatedProviderNodes,
          failed: failures.filter((failure) => failure.assetType === "providerNodeApiKey").length
        },
        alertChannelTargets: {
          scanned: alertChannels.length,
          rotated: rotatedAlertChannels,
          failed: failures.filter((failure) => failure.assetType === "alertChannelTarget").length
        }
      },
      failures
    };
  } finally {
    await nodes.close();
    await channels.close();
  }
}

export const rotateProviderNodeApiKeys = rotateEncryptedSecrets;

if (process.argv[1]?.endsWith("scripts/rotate-encryption-key.ts")) {
  const result = await rotateEncryptedSecrets(readOptionsFromEnv(process.argv.slice(2)));
  console.log(
    `[rotate-encryption-key] mode=${result.mode} scanned=${result.scanned} rotated=${result.rotated} failed=${result.failed}`
  );
  for (const failure of result.failures) {
    console.error(`[rotate-encryption-key] failed ${failure.assetType}=${failure.assetId}: ${failure.reason}`);
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
