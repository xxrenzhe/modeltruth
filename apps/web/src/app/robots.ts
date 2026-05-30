import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/api/", "/workspace/", "/billing/", "/evidence/private/", "/admin/"]
      }
    ],
    sitemap: "https://modeltruth.ai/sitemap.xml"
  };
}
