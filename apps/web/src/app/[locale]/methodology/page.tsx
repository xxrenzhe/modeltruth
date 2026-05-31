import type { Locale } from "@modeltruth/i18n";
import { buildSeoMetadata, faqPageJsonLd, jsonLdScript } from "@modeltruth/seo";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  return buildSeoMetadata({
    locale,
    path: "/methodology",
    title: "AI API audit methodology | ModelTruth.ai",
    description:
      "How ModelTruth evaluates availability, TTFT, model consistency, context handling and billing variance."
  });
}

export default function MethodologyPage() {
  return (
    <article className="card">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          faqPageJsonLd([
            {
              question: "Does ModelTruth make legal wrongdoing determinations?",
              answer:
                "No. ModelTruth publishes technical evidence signals, confidence and retest recommendations."
            },
            {
              question: "Why use nonce prompts?",
              answer:
                "Nonce prompts reduce cache contamination and make repeated black-box audits more reproducible."
            }
          ])
        )}
      />
      <div className="eyebrow">Technical Methodology</div>
      <h1>Evidence signals, not legal conclusions.</h1>
      <p className="lede">
        ModelTruth runs black-box probes against OpenAI-compatible endpoints, captures
        timing and usage metadata, evaluates registered assertions and stores redacted
        evidence summaries for repeatable review.
      </p>
      <div className="metricGrid">
        <div className="metric">Availability</div>
        <div className="metric">TTFT and latency</div>
        <div className="metric">Model consistency</div>
        <div className="metric">Billing variance</div>
      </div>
    </article>
  );
}
