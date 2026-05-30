import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /(authorization["':\s]+bearer\s+)[A-Za-z0-9._-]+/gi,
  /(apiKey["':\s]+)[A-Za-z0-9._-]+/gi
];

export function redactSecrets<T>(value: T): T {
  const json = JSON.stringify(value);
  let redacted = json;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, (match, prefix) =>
      typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]"
    );
  }
  return JSON.parse(redacted) as T;
}

export function getSecretSuffix(secret: string, visibleChars = 4): string {
  return secret.length <= visibleChars ? secret : secret.slice(-visibleChars);
}

export function encryptSecret(plaintext: string, keyMaterial = process.env.APP_SECRET_ENCRYPTION_KEY ?? "dev-modeltruth-secret"): string {
  const key = deriveAesKey(keyMaterial);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", toBase64Url(iv), toBase64Url(tag), toBase64Url(ciphertext)].join(":");
}

export function decryptSecret(encrypted: string, keyMaterial = process.env.APP_SECRET_ENCRYPTION_KEY ?? "dev-modeltruth-secret"): string {
  const [version, iv, tag, ciphertext] = encrypted.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveAesKey(keyMaterial), fromBase64Url(iv));
  decipher.setAuthTag(fromBase64Url(tag));
  return Buffer.concat([decipher.update(fromBase64Url(ciphertext)), decipher.final()]).toString("utf8");
}

function deriveAesKey(keyMaterial: string): Buffer {
  return createHash("sha256").update(keyMaterial).digest();
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
