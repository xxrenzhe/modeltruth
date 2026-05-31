import { notFound } from "next/navigation";
import type { Locale } from "@modeltruth/i18n";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildSeoMetadata,
  faqPageJsonLd,
  guides,
  jsonLdScript,
  localizedPath
} from "@modeltruth/seo";

function findGuide(slug: string) {
  return guides.find((guide) => guide.slug === slug);
}

export function generateStaticParams() {
  return guides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();

  return buildSeoMetadata({
    locale,
    path: `/guides/${guide.slug}`,
    title: `${guide.title} | ModelTruth.ai`,
    description: guide.description
  });
}

export default async function GuidePage({
  params
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();
  const pageUrl = absoluteUrl(localizedPath(locale, `/guides/${guide.slug}`));

  return (
    <article className="card">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(localizedPath(locale, "")) },
            { name: "Guides", url: pageUrl }
          ])
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          faqPageJsonLd([
            {
              question: "Can one audit prove a provider is misrepresented?",
              answer:
                "No. ModelTruth uses repeatable technical signals and confidence, not one-off legal conclusions."
            },
            {
              question: "Should private prompts be uploaded?",
              answer:
                "No. Use synthetic prompts or redacted evidence unless explicit consent is configured."
            }
          ])
        )}
      />
      <div className="eyebrow">Guide</div>
      <h1>{guide.title}</h1>
      <p className="lede">{guide.description}</p>
      <div className="metricGrid">
        <div className="metric">1. Validate endpoint safety.</div>
        <div className="metric">2. Run nonce smoke probes.</div>
        <div className="metric">3. Compare usage and latency.</div>
        <div className="metric">4. Save redacted evidence.</div>
      </div>
    </article>
  );
}
