import type { MetadataRoute } from "next";
import { locales } from "@modeltruth/i18n";

const baseUrl = "https://modeltruth.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/playground", "/providers/openai", "/methodology", "/pricing"];
  return locales.flatMap((locale) =>
    routes.map((route) => ({
      url: `${baseUrl}/${locale}${route}`,
      lastModified: new Date(),
      alternates: {
        languages: Object.fromEntries(locales.map((item) => [item, `${baseUrl}/${item}${route}`]))
      }
    }))
  );
}
