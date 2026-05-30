import type { Metadata } from "next";
import { locales, type Locale } from "@modeltruth/i18n";

const siteUrl = "https://modeltruth.ai";

export function buildLocalizedMetadata(input: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  noIndex?: boolean;
}): Metadata {
  const canonical = `${siteUrl}/${input.locale}${input.path}`;
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical,
      languages: Object.fromEntries(
        locales.map((locale) => [locale, `${siteUrl}/${locale}${input.path}`])
      )
    },
    openGraph: {
      title: input.title,
      description: input.description,
      url: canonical,
      siteName: "ModelTruth.ai",
      locale: input.locale
    },
    robots: input.noIndex ? { index: false, follow: false } : { index: true, follow: true }
  };
}
