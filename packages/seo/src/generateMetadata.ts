import type { Metadata } from "next";
import { defaultLocale, locales, translatedLocales, type Locale } from "@modeltruth/i18n";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://modeltruth.ai").replace(/\/$/, "");
const siteName = "ModelTruth.ai";
const defaultOgImage = "/og/modeltruth-default.svg";

export type SeoInput = {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  noIndex?: boolean;
  canonicalLocale?: Locale;
  imagePath?: string;
};

export function absoluteUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl}${normalized}`;
}

export function localizedPath(locale: Locale, path: string) {
  const normalized = path === "/" ? "" : path.replace(/^\//, "");
  return normalized ? `/${locale}/${normalized}` : `/${locale}`;
}

export function languageAlternates(path: string, options: { includeNoIndex?: boolean } = {}) {
  const indexedLocales = options.includeNoIndex ? locales : locales.filter((locale) => !getSeoPolicy(locale, path).noIndex);
  return Object.fromEntries([
    ...indexedLocales.map((locale) => [locale, absoluteUrl(localizedPath(locale, path))]),
    ["x-default", absoluteUrl(localizedPath(defaultLocale, path))]
  ]);
}

export function getSeoPolicy(locale: Locale, path: string) {
  const normalized = path || "";
  const untranslatedLocale = !(translatedLocales as readonly Locale[]).includes(locale);
  const generatedEnglishOnly =
    locale !== defaultLocale && (normalized.startsWith("/guides/") || normalized.startsWith("/compare/"));
  return {
    noIndex: untranslatedLocale || generatedEnglishOnly,
    canonicalLocale: untranslatedLocale || generatedEnglishOnly ? defaultLocale : locale
  };
}

export function isIndexablePath(locale: Locale, path: string) {
  return !getSeoPolicy(locale, path).noIndex;
}

export function buildSeoMetadata(input: SeoInput): Metadata {
  const policy = getSeoPolicy(input.locale, input.path);
  const noIndex = input.noIndex ?? policy.noIndex;
  const canonicalLocale = input.canonicalLocale ?? policy.canonicalLocale;
  const canonical = absoluteUrl(localizedPath(canonicalLocale, input.path));
  const image = absoluteUrl(input.imagePath ?? defaultOgImage);

  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical,
      languages: languageAlternates(input.path)
    },
    openGraph: {
      title: input.title,
      description: input.description,
      url: canonical,
      siteName,
      locale: input.locale,
      images: [{ url: image, width: 1200, height: 630, alt: input.title }],
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [image]
    },
    robots: noIndex
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : { index: true, follow: true, googleBot: { index: true, follow: true } }
  };
}

export function softwareApplicationJsonLd(locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteName,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    description:
      "Evidence-driven monitoring for AI API availability, model authenticity and billing consistency."
  };
}

export function faqPageJsonLd(items: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer }
    }))
  };
}

export function datasetJsonLd(name: string, description: string, url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name,
    description,
    url,
    creator: { "@type": "Organization", name: siteName },
    measurementTechnique: "OpenAI-compatible API black-box technical audit"
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function jsonLdScript(data: unknown) {
  return {
    __html: JSON.stringify(data).replace(/</g, "\\u003c")
  };
}
