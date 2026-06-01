import { describe, expect, it } from "vitest";
import { locales } from "@modeltruth/i18n";
import { absoluteUrl, isIndexablePath, localizedPath, publicPaths } from "@modeltruth/seo";
import robots from "./app/robots";
import sitemap from "./app/sitemap";

describe("sitemap and robots policy", () => {
  it("keeps API and internal workspace surfaces out of robots indexing", () => {
    const rules = robots().rules;
    const disallow = Array.isArray(rules) ? [] : rules.disallow;

    expect(disallow).toEqual(
      expect.arrayContaining([
        "/api/",
        "/*/workspace",
        "/*/workspace/",
        "/*/billing",
        "/*/billing/",
        "/evidence/private/",
        "/*/evidence/private/",
        "/admin/",
        "/*/admin/"
      ])
    );
  });

  it("publishes only indexable localized public pages with alternates", () => {
    const entries = sitemap();
    const urls = new Set(entries.map((entry) => entry.url));

    for (const locale of locales) {
      for (const path of publicPaths) {
        const url = absoluteUrl(localizedPath(locale, path));
        if (isIndexablePath(locale, path)) {
          expect(urls.has(url), `${locale}:${path}`).toBe(true);
          expect(entries.find((entry) => entry.url === url)?.alternates?.languages).toBeTruthy();
        } else {
          expect(urls.has(url), `${locale}:${path}`).toBe(false);
        }
      }
    }
    expect([...urls].some((url) => url.includes("/api/") || url.includes("/workspace"))).toBe(false);
  });
});
