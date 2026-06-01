import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, locales, type Locale } from "@modeltruth/i18n";
import "../globals.css";
import { GtmVisitBeacon } from "./gtm-visit-beacon";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh-CN" }];
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale);
  return {
    title: dictionary.meta.title,
    description: dictionary.meta.description
  };
}

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dictionary = getDictionary(locale as Locale);

  return (
    <html lang={locale}>
      <body>
        <GtmVisitBeacon />
        <main className="shell">
          <nav className="nav">
            <a className="brand" href={`/${locale}`}>
              ModelTruth.ai
            </a>
            <div className="navLinks">
              <a href={`/${locale}/playground`}>{dictionary.nav.playground}</a>
              <a href={`/${locale}/providers/openai`}>{dictionary.nav.providers}</a>
              <a href={`/${locale}/methodology`}>{dictionary.nav.methodology}</a>
              <a href={`/${locale}/pricing`}>{dictionary.nav.pricing}</a>
              <a href={`/${locale}/settings/privacy`}>Privacy settings</a>
              <a href={`/${locale}/workspace`}>{dictionary.nav.workspace}</a>
              <a href={`/${locale}/evidence`}>{dictionary.nav.evidence}</a>
              <a href={`/${locale}/login`}>{dictionary.nav.login}</a>
            </div>
            <div aria-label="Language selector" className="localeSwitch">
              {locales.map((option) => (
                <a aria-current={option === locale ? "true" : undefined} href={`/${option}`} key={option} hrefLang={option}>
                  {option}
                </a>
              ))}
            </div>
          </nav>
          {children}
          <footer className="legalNotice">
            <strong>{dictionary.legal.disclaimerTitle}</strong>
            <p>{dictionary.legal.disclaimer}</p>
          </footer>
        </main>
      </body>
    </html>
  );
}
