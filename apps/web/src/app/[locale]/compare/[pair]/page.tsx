import { notFound } from "next/navigation";
import type { Locale } from "@modeltruth/i18n";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildSeoMetadata,
  comparePairs,
  faqPageJsonLd,
  jsonLdScript,
  localizedPath
} from "@modeltruth/seo";

function parsePair(pair: string) {
  if (!comparePairs.includes(pair as (typeof comparePairs)[number])) return null;
  const [left, right] = pair.split("-vs-");
  return { left, right };
}

export function generateStaticParams() {
  return comparePairs.map((pair) => ({ pair }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale; pair: string }>;
}) {
  const { locale, pair } = await params;
  const parsed = parsePair(pair);
  if (!parsed) notFound();

  return buildSeoMetadata({
    locale,
    path: `/compare/${pair}`,
    title: `${parsed.left} vs ${parsed.right} AI API audit comparison | ModelTruth.ai`,
    description:
      "Compare AI API providers using uptime, latency, risk flags, model consistency and billing evidence signals."
  });
}

export default async function ComparePage({
  params
}: {
  params: Promise<{ locale: Locale; pair: string }>;
}) {
  const { locale, pair } = await params;
  const parsed = parsePair(pair);
  if (!parsed) notFound();
  const pageUrl = absoluteUrl(localizedPath(locale, `/compare/${pair}`));
  const leftName = providerLabel(parsed.left);
  const rightName = providerLabel(parsed.right);

  return (
    <article className="card">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([
            { name: "Home", url: absoluteUrl(localizedPath(locale, "")) },
            { name: "Compare", url: pageUrl }
          ])
        )}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          faqPageJsonLd([
            {
              question: "Is this a legal ranking?",
              answer: "No. The comparison summarizes repeatable technical audit signals."
            },
            {
              question: "What signals are compared?",
              answer: "Availability, TTFT, errors, risk flags, model behavior and billing variance."
            }
          ])
        )}
      />
      <div className="eyebrow">AI API Compare</div>
      <h1>
        {leftName} vs {rightName}
      </h1>
      <p className="lede">
        Compare {leftName} with {rightName} using ModelTruth audit signals: uptime,
        TTFT, error rate, model consistency, context behavior and billing variance.
      </p>
      <div className="metricGrid">
        <div className="metric">Uptime trend</div>
        <div className="metric">P95 TTFT</div>
        <div className="metric">Risk flags</div>
        <div className="metric">Evidence score</div>
      </div>
    </article>
  );
}

function providerLabel(slug: string) {
  const labels: Record<string, string> = {
    official: "official APIs",
    openai: "OpenAI",
    anthropic: "Anthropic",
    openrouter: "OpenRouter"
  };
  return labels[slug] ?? slug;
}
