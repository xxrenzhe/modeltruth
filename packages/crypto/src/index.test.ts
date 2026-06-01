import { describe, expect, it } from "vitest";
import {
  createProviderUnsubscribeToken,
  decryptSecret,
  encryptSecret,
  getSecretSuffix,
  parseProviderUnsubscribeToken,
  redactSecrets
} from "./index";

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

  it("keeps public token usage counters while redacting authentication tokens", () => {
    expect(
      redactSecrets({
        usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13, reasoningTokens: 1 },
        authToken: "session-token-123",
        botToken: "telegram-token-123"
      })
    ).toEqual({
      usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13, reasoningTokens: 1 },
      authToken: "[REDACTED]",
      botToken: "[REDACTED]"
    });
  });

  it("creates opaque provider unsubscribe tokens without exposing subscriber email", () => {
    const previousSecret = process.env.PROVIDER_UNSUBSCRIBE_SECRET;
    process.env.PROVIDER_UNSUBSCRIBE_SECRET = "test-provider-unsubscribe-secret";

    const token = createProviderUnsubscribeToken({
      providerSlug: "openrouter",
      email: "subscriber@example.com",
      notificationType: "weekly_digest"
    });
    const parsed = parseProviderUnsubscribeToken(token);

    if (previousSecret === undefined) delete process.env.PROVIDER_UNSUBSCRIBE_SECRET;
    else process.env.PROVIDER_UNSUBSCRIBE_SECRET = previousSecret;

    expect(token).not.toContain("subscriber@example.com");
    expect(token).not.toContain("openrouter");
    expect(parsed).toEqual({
      providerSlug: "openrouter",
      email: "subscriber@example.com",
      notificationType: "weekly_digest"
    });
  });
});
