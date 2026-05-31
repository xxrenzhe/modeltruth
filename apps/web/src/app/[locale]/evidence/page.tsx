import { getDictionary, type Locale } from "@modeltruth/i18n";
import { absoluteUrl, breadcrumbJsonLd, buildSeoMetadata, jsonLdScript } from "@modeltruth/seo";
import { EvidenceClient } from "./evidence-client";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/evidence",
    title: "Evidence Center | ModelTruth.ai",
    description: "Review redacted audit runs, risk flags and exportable technical evidence packages."
  });
}

export default async function EvidencePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(`/${locale}`) },
            { name: "Evidence Center", url: absoluteUrl(`/${locale}/evidence`) }
          ])
        )}
      />
      <section className="hero compactHero">
        <div>
          <div className="eyebrow">{dictionary.evidence.eyebrow}</div>
          <h1>{dictionary.evidence.title}</h1>
          <p className="lede">{dictionary.evidence.lede}</p>
        </div>
      </section>
      <EvidenceClient labels={dictionary.evidence} />
    </>
  );
}
