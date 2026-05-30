import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, getSecretSuffix, redactSecrets } from "./index";

describe("crypto helpers", () => {
  it("encrypts and decrypts API keys with AES-GCM format", () => {
    const encrypted = encryptSecret("sk-test-redaction-123456", "test-key");
    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain("sk-test-redaction");
    expect(decryptSecret(encrypted, "test-key")).toBe("sk-test-redaction-123456");
  });

  it("redacts and suffixes secrets without exposing the full value", () => {
    expect(getSecretSuffix("sk-test-redaction-123456")).toBe("3456");
    expect(JSON.stringify(redactSecrets({ apiKey: "sk-test-redaction-123456" }))).not.toContain("sk-test-redaction");
  });
});
