import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparePairs, guides, providers, publicPaths } from "@modeltruth/seo";

const appLocaleRoot = path.join(process.cwd(), "apps/web/src/app/[locale]");
const explicitNoIndexPaths = ["/login", "/workspace"] as const;

describe("public route SEO contract", () => {
  it("keeps real locale page routes classified as either indexable SEO paths or explicit noindex pages", () => {
    const routeFiles = findPageFiles(appLocaleRoot);
    const expandedIndexableRoutes = new Set(publicPaths);
    const expandedNoIndexRoutes = new Set<string>(explicitNoIndexPaths);

    for (const file of routeFiles) {
      const routePattern = routePatternForFile(file);
      const expandedRoutes = expandRoutePattern(routePattern);

      for (const route of expandedRoutes) {
        expect(
          expandedIndexableRoutes.has(route) || expandedNoIndexRoutes.has(route),
          `${routePattern} produced unclassified route ${route}`
        ).toBe(true);
      }
    }
  });

  it("requires every indexable SEO path to have a page file, metadata and JSON-LD", () => {
    for (const seoPath of publicPaths) {
      const file = pageFileForSeoPath(seoPath);
      expect(existsSync(file), `${seoPath} missing page file ${file}`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${seoPath} missing generateMetadata`).toContain("generateMetadata");
      expect(source, `${seoPath} missing buildSeoMetadata`).toContain("buildSeoMetadata");
      expect(source, `${seoPath} missing application/ld+json`).toContain("application/ld+json");
      expect(source, `${seoPath} missing jsonLdScript`).toContain("jsonLdScript");
    }
  });

  it("requires non-indexed locale pages to opt out of robots indexing explicitly", () => {
    for (const seoPath of explicitNoIndexPaths) {
      const file = pageFileForSeoPath(seoPath);
      expect(existsSync(file), `${seoPath} missing page file ${file}`).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${seoPath} missing generateMetadata`).toContain("generateMetadata");
      expect(source, `${seoPath} missing robots metadata`).toContain("robots");
      expect(source, `${seoPath} missing noindex`).toContain("index: false");
      expect(source, `${seoPath} missing nofollow`).toContain("follow: false");
    }
  });
});

function findPageFiles(root: string) {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findPageFiles(fullPath));
    } else if (entry === "page.tsx") {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function routePatternForFile(file: string) {
  const relative = path.relative(appLocaleRoot, path.dirname(file));
  if (relative === "") return "";
  return `/${relative.split(path.sep).join("/")}`;
}

function expandRoutePattern(routePattern: string) {
  if (routePattern === "/providers/[providerSlug]") {
    return providers.map((provider) => `/providers/${provider}`);
  }
  if (routePattern === "/compare/[pair]") {
    return comparePairs.map((pair) => `/compare/${pair}`);
  }
  if (routePattern === "/guides/[slug]") {
    return guides.map((guide) => `/guides/${guide.slug}`);
  }
  return [routePattern];
}

function pageFileForSeoPath(seoPath: string) {
  if (seoPath === "") return path.join(appLocaleRoot, "page.tsx");
  if (seoPath.startsWith("/providers/")) return path.join(appLocaleRoot, "providers/[providerSlug]/page.tsx");
  if (seoPath.startsWith("/compare/")) return path.join(appLocaleRoot, "compare/[pair]/page.tsx");
  if (seoPath.startsWith("/guides/")) return path.join(appLocaleRoot, "guides/[slug]/page.tsx");
  return path.join(appLocaleRoot, seoPath.replace(/^\//, ""), "page.tsx");
}
