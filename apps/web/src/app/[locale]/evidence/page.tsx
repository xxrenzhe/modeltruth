import { getDictionary, type Locale } from "@modeltruth/i18n";
import { EvidenceClient } from "./evidence-client";

export default async function EvidencePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);

  return (
    <>
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
