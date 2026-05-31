import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://modeltruth.ai").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/*/workspace",
        "/*/workspace/",
        "/*/billing",
        "/*/billing/",
        "/evidence/private/",
        "/*/evidence/private/",
        "/admin/",
        "/*.env",
        "/*.sql",
        "/*.bak",
        "/*.log",
        "/*.pem"
      ]
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl
  };
}
