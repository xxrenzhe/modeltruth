import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAppConfig } from "@modeltruth/config";

const algorithm = "aes-256-gcm";
const redacted = "[REDACTED]";
const sensitiveKeyPattern = /(api[-_]?key|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?token|bot[-_]?token|secret|password|encryptedApiKey)/i;

export type ProviderDigestNotificationType = "risk_trend" | "weekly_digest";

export interface ProviderUnsubscribeTokenPayload {
  providerSlug: string;
  email: string;
  notificationType: ProviderDigestNotificationType;
}

export function encryptSecret(value: string, key = getAppConfig().encryptionKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, deriveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(encryptedValue: string, key = getAppConfig().encryptionKey): string {
  const [version, iv, tag, ciphertext] = encryptedValue.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv(algorithm, deriveKey(key), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function getSecretSuffix(value: string, length = 4): string {
  return value.slice(-length);
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

export function createProviderUnsubscribeToken(input: ProviderUnsubscribeTokenPayload): string {
  return encryptSecret(JSON.stringify({ v: 1, ...input }), providerUnsubscribeSecret());
}

export function parseProviderUnsubscribeToken(token: string): ProviderUnsubscribeTokenPayload {
  const payload = JSON.parse(decryptSecret(token, providerUnsubscribeSecret())) as Partial<ProviderUnsubscribeTokenPayload> & { v?: unknown };
  const providerSlug = typeof payload.providerSlug === "string" ? payload.providerSlug : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  const notificationType = payload.notificationType;
  if (payload.v !== 1 || !providerSlug || !email || (notificationType !== "risk_trend" && notificationType !== "weekly_digest")) {
    throw new Error("unsubscribe token is invalid");
  }
  return { providerSlug, email, notificationType };
}

function deriveKey(key: string) {
  return createHash("sha256").update(key).digest();
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveKey(key) ? redacted : redactValue(nested)
      ])
    );
  }
  if (typeof value === "string" && looksLikeSecret(value)) return redacted;
  return value;
}

function isSensitiveKey(key: string) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return sensitiveKeyPattern.test(normalized);
}

function looksLikeSecret(value: string) {
  return /sk-[A-Za-z0-9_-]{8,}/.test(value) || /^Bearer\s+\S+/i.test(value);
}

function providerUnsubscribeSecret() {
  return process.env.PROVIDER_UNSUBSCRIBE_SECRET ?? getAppConfig().encryptionKey;
}
