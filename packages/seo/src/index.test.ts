import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { locales } from "@modeltruth/i18n";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildSeoMetadata,
  faqPageJsonLd,
  getSeoPolicy,
  isIndexablePath,
  isKnownProviderSlug,
  languageAlternates,
  publicPaths,
  softwareApplicationJsonLd
} from "./index";
import { buildSeoMetadata as buildSeoMetadataFromNamedArtifact } from "./generateMetadata";

describe("seo helpers", () => {
  it("builds canonical, hreflang, OG, Twitter and robots metadata", () => {
    const metadata = buildSeoMetadata({
      locale: "en",
      path: "/playground",
      title: "Test API",
      description: "Run an AI API smoke audit."
    });

    expect(metadata.alternates?.canonical).toBe("https://modeltruth.ai/en/playground");
    expect(metadata.alternates?.languages).toMatchObject({
      en: "https://modeltruth.ai/en/playground",
      "zh-CN": "https://modeltruth.ai/zh-CN/playground",
      "x-default": "https://modeltruth.ai/en/playground"
    });
    expect(metadata.openGraph).toMatchObject({ title: "Test API" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(buildSeoMetadataFromNamedArtifact).toBe(buildSeoMetadata);
  });

  it("covers the public SEO route matrix", () => {
    expect(publicPaths).toContain("/compare/openai-vs-anthropic");
    expect(publicPaths).toContain("/compare/openrouter-vs-official");
    expect(publicPaths).toContain("/guides/how-to-test-openai-compatible-api");
    expect(publicPaths).toContain("/guides/verify-openai-compatible-api");
    expect(publicPaths).toContain("/providers/google-gemini");
    expect(publicPaths).toContain("/providers/openrouter");
    expect(isKnownProviderSlug("openrouter")).toBe(true);
    expect(isKnownProviderSlug("made-up-provider")).toBe(false);
    expect(languageAlternates("/pricing")["x-default"]).toBe("https://modeltruth.ai/en/pricing");
  });

  it("generates complete metadata for every public path and locale", () => {
    for (const path of publicPaths) {
      for (const locale of locales) {
        const policy = getSeoPolicy(locale, path);
        const metadata = buildSeoMetadata({
          locale,
          path,
          title: `ModelTruth ${path || "home"}`,
          description: `Localized metadata for ${path || "home"}`
        });
        expect(metadata.description, `${locale}:${path} description`).toBeTruthy();
        expect(metadata.alternates?.canonical, `${locale}:${path} canonical`).toBe(
          absoluteUrl(`/${policy.canonicalLocale}${path}`)
        );
        expect(metadata.alternates?.languages, `${locale}:${path} hreflang`).toMatchObject(languageAlternates(path));
        expect(metadata.openGraph, `${locale}:${path} openGraph`).toMatchObject({
          description: metadata.description,
          url: metadata.alternates?.canonical
        });
        expect(metadata.openGraph?.images, `${locale}:${path} OG image`).toEqual(
          expect.arrayContaining([expect.objectContaining({ url: "https://modeltruth.ai/og/modeltruth-default.svg" })])
        );
        expect(metadata.twitter, `${locale}:${path} twitter`).toMatchObject({ card: "summary_large_image" });
        expect(metadata.robots, `${locale}:${path} robots`).toMatchObject(
          policy.noIndex ? { index: false, follow: false } : { index: true, follow: true }
        );
      }
    }
  });

  it("noindexes generated English-only locale pages and keeps them out of hreflang", () => {
    const metadata = buildSeoMetadata({
      locale: "zh-CN",
      path: "/guides/how-to-test-openai-compatible-api",
      title: "Guide",
      description: "English-only generated guide"
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBe(
      "https://modeltruth.ai/en/guides/how-to-test-openai-compatible-api"
    );
    expect(metadata.alternates?.languages).not.toHaveProperty("zh-CN");
    expect(isIndexablePath("zh-CN", "/compare/openrouter-vs-official")).toBe(false);
  });

  it("supports P1 locales as routes but keeps untranslated pages out of the index", () => {
    for (const locale of ["ja", "ko", "de", "fr"] as const) {
      const metadata = buildSeoMetadata({
        locale,
        path: "/pricing",
        title: "Pricing",
        description: "English fallback pricing copy"
      });

      expect(metadata.robots, locale).toMatchObject({ index: false, follow: false });
      expect(metadata.alternates?.canonical, locale).toBe("https://modeltruth.ai/en/pricing");
      expect(metadata.alternates?.languages, locale).not.toHaveProperty(locale);
      expect(isIndexablePath(locale, "/pricing"), locale).toBe(false);
    }
    expect(languageAlternates("/pricing")).toMatchObject({
      en: "https://modeltruth.ai/en/pricing",
      "zh-CN": "https://modeltruth.ai/zh-CN/pricing",
      "x-default": "https://modeltruth.ai/en/pricing"
    });
    expect(languageAlternates("/pricing")).not.toHaveProperty("ja");
  });

  it("builds JSON-LD objects without leaking script delimiters", () => {
    const app = softwareApplicationJsonLd("en");
    const faq = faqPageJsonLd([{ question: "Q", answer: "A" }]);
    const breadcrumbs = breadcrumbJsonLd([{ name: "Home", url: absoluteUrl("/en") }]);

    expect(app).toMatchObject({ "@type": "SoftwareApplication", name: "ModelTruth.ai" });
    expect(faq).toMatchObject({ "@type": "FAQPage" });
    expect(breadcrumbs).toMatchObject({ "@type": "BreadcrumbList" });
  });

  it("points default OG metadata at a committed static asset", () => {
    const metadata = buildSeoMetadata({
      locale: "en",
      path: "",
      title: "ModelTruth.ai",
      description: "Evidence-driven AI API audit monitoring."
    });
    const images = metadata.openGraph?.images;
    const image = Array.isArray(images) ? images[0] : images;

    expect(image).toMatchObject({ url: "https://modeltruth.ai/og/modeltruth-default.svg", width: 1200, height: 630 });
    expect(existsSync("apps/web/public/og/modeltruth-default.svg")).toBe(true);
  });
});
