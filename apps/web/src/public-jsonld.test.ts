import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comparePairs, guides, providers, publicPaths } from "@modeltruth/seo";

describe("public page JSON-LD coverage", () => {
  it("adds structured data to every indexable public page template", () => {
    const pageFiles = [...new Set(publicPaths.map(pageFileForPath))].sort();

    for (const file of pageFiles) {
      expect(existsSync(file), file).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${file} missing application/ld+json`).toContain("application/ld+json");
      expect(source, `${file} missing jsonLdScript helper`).toContain("jsonLdScript");
    }
  });
});

function pageFileForPath(path: string) {
  if (path === "") return "apps/web/src/app/[locale]/page.tsx";
  if (path.startsWith("/providers/") && providers.some((provider) => path === `/providers/${provider}`)) {
    return "apps/web/src/app/[locale]/providers/[providerSlug]/page.tsx";
  }
  if (path.startsWith("/compare/") && comparePairs.some((pair) => path === `/compare/${pair}`)) {
    return "apps/web/src/app/[locale]/compare/[pair]/page.tsx";
  }
  if (path.startsWith("/guides/") && guides.some((guide) => path === `/guides/${guide.slug}`)) {
    return "apps/web/src/app/[locale]/guides/[slug]/page.tsx";
  }
  return `apps/web/src/app/[locale]${path}/page.tsx`;
}
