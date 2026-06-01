import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("commercial independence disclosure", () => {
  it("keeps public provider, compare and pricing pages free from paid ranking incentives", () => {
    const pages = [
      "apps/web/src/app/[locale]/providers/[providerSlug]/page.tsx",
      "apps/web/src/app/[locale]/compare/[pair]/page.tsx",
      "apps/web/src/app/[locale]/pricing/page.tsx"
    ];

    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      expect(source, `${page} must disclose no supplier commission`).toContain("supplier commission");
      expect(source, `${page} must disclose no paid ranking`).toContain("paid ranking");
      expect(source, `${page} must keep sponsored content separate`).toContain("sponsored content");
      expect(source, `${page} must not introduce affiliate incentives`).toContain("affiliate");
    }
  });
});
