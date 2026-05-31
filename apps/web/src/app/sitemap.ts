import type { MetadataRoute } from "next";
import { locales } from "@modeltruth/i18n";
import { absoluteUrl, isIndexablePath, languageAlternates, localizedPath, publicPaths } from "@modeltruth/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return locales.flatMap((locale) =>
    publicPaths
      .filter((path) => isIndexablePath(locale, path))
      .map((path) => ({
        url: absoluteUrl(localizedPath(locale, path)),
        lastModified: now,
        changeFrequency: path.includes("/evidence") ? "hourly" : "weekly",
        priority: path === "" ? 1 : path.startsWith("/providers") ? 0.9 : 0.7,
        alternates: {
          languages: languageAlternates(path)
        }
      }))
  );
}
