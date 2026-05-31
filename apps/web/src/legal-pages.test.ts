import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legal compliance pages", () => {
  it("privacy page covers data categories, purpose, retention and third-party processors", () => {
    const source = readFileSync("apps/web/src/app/[locale]/privacy/page.tsx", "utf8");

    for (const required of [
      "Data categories",
      "Account information",
      "Subscription information",
      "Audit metrics",
      "Data we do not collect",
      "Purpose and legal basis",
      "Retention",
      "Stripe",
      "production PostgreSQL",
      "ClawCloud/GHCR",
      "We do not sell personal information"
    ]) {
      expect(source).toContain(required);
    }
  });

  it("terms page states authority to test and acceptable-use restrictions", () => {
    const source = readFileSync("apps/web/src/app/[locale]/terms/page.tsx", "utf8");

    for (const required of [
      "Authority to test",
      "right to test every endpoint",
      "API key",
      "DDoS",
      "pressure testing",
      "access controls",
      "liability is capped",
      "previous three months"
    ]) {
      expect(source).toContain(required);
    }
  });

  it("dispute policy is public and includes disclaimer plus review statuses", () => {
    const source = readFileSync("apps/web/src/app/[locale]/dispute/page.tsx", "utf8");

    for (const required of [
      "Dispute Policy",
      "not legal conclusions",
      "Providers may submit corrections",
      "Under review",
      "Resolved",
      "Provider response attached",
      "compliance@modeltruth.ai"
    ]) {
      expect(source).toContain(required);
    }
  });
});
