import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedRoutes = [
  "apps/web/src/app/api/playground/audit/route.ts",
  "apps/web/src/app/api/workspace/nodes/route.ts",
  "apps/web/src/app/api/workspace/alert-channels/route.ts"
];

describe("public endpoint guard", () => {
  it("uses the shared public HTTPS validator for user-controlled callback and API endpoints", () => {
    for (const file of guardedRoutes) {
      const source = readFileSync(file, "utf8");

      expect(source).toContain("validatePublicHttpsUrl");
      expect(source).toContain("assertPublicResolvedAddresses");
      expect(source).not.toContain("function isPublicHostname");
      expect(source).not.toContain("metadata.google.internal");
    }
  });

  it("checks resolved DNS addresses before Playground quota consumption", () => {
    const source = readFileSync("apps/web/src/app/api/playground/audit/route.ts", "utf8");
    const dnsCheckIndex = source.indexOf("assertPublicResolvedAddresses(baseUrl");
    const quotaIndex = source.indexOf("consumePlaygroundQuota(request)");

    expect(dnsCheckIndex).toBeGreaterThan(-1);
    expect(quotaIndex).toBeGreaterThan(dnsCheckIndex);
  });
});
