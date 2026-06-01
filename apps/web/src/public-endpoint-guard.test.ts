import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedRoutes = [
  "apps/web/src/app/api/playground/audit/route.ts",
  "apps/web/src/app/api/workspace/nodes/route.ts",
  "apps/web/src/app/api/workspace/alert-channels/route.ts"
];
const guardedClients = [
  "apps/web/src/app/[locale]/playground/playground-client.tsx",
  "apps/web/src/app/[locale]/workspace/workspace-client.tsx"
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

  it("performs frontend Base URL validation before Playground and Workspace node submissions", () => {
    for (const file of guardedClients) {
      const source = readFileSync(file, "utf8");
      const validationIndex = source.indexOf('validatePublicHttpsUrl(baseUrl, "Base URL")');
      const fetchIndex = source.indexOf('fetch("/api/', validationIndex);

      expect(validationIndex, `${file} should validate Base URL on the client`).toBeGreaterThan(-1);
      expect(fetchIndex, `${file} should submit after validating`).toBeGreaterThan(validationIndex);
    }
  });
});
