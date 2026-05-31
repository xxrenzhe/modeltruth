import { getDictionary, type Locale } from "@modeltruth/i18n";
import { getPublicAuditSummary } from "@modeltruth/db";
import {
  buildSeoMetadata,
  jsonLdScript,
  softwareApplicationJsonLd
} from "@modeltruth/seo";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  return buildSeoMetadata({
    locale,
    path: "",
    title: dictionary.meta.title,
    description: dictionary.meta.description
  });
}

export default async function HomePage({
  params
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const dictionary = getDictionary(locale);
  const summary = await getPublicAuditSummary();
  const window24h = summary.windows["24h"];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(softwareApplicationJsonLd(locale))}
      />
      <section className="hero">
        <div>
          <div className="eyebrow">{dictionary.home.eyebrow}</div>
          <h1>{dictionary.home.title}</h1>
          <p className="lede">{dictionary.home.lede}</p>
          <div className="actions">
            <a className="button" href={`/${locale}/playground`}>
              {dictionary.home.primaryCta}
            </a>
            <a className="button secondary" href={`/${locale}/methodology`}>
              {dictionary.home.secondaryCta}
            </a>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow">{dictionary.home.truthBoard}</div>
          <div className="statusList">
            {dictionary.providers.map((provider) => (
              <div className="statusRow" key={provider.slug}>
                <span>{provider.name}</span>
                <span className={`pill ${providerStatus(summary, provider.slug, provider.status)}`}>
                  {providerStatus(summary, provider.slug, provider.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="metricGrid" aria-label={dictionary.home.metricsLabel}>
        <div className="metric">
          <strong>{summary.totalRuns}</strong>
          30d audit runs
        </div>
        <div className="metric">
          <strong>{Math.round(window24h.uptime * 100)}%</strong>
          24h uptime
        </div>
        <div className="metric">
          <strong>{summary.p95TtftMs ?? "n/a"}ms</strong>
          30d P95 TTFT
        </div>
        <div className="metric">
          <strong>{summary.evidenceScore}</strong>
          Evidence score
        </div>
        <div className="metric">
          <strong>{summary.isFresh ? "fresh" : "stale"}</strong>
          Dashboard data age {formatFreshness(summary.dataFreshnessSeconds)}
        </div>
      </section>
    </>
  );
}

function formatFreshness(seconds: number | undefined) {
  if (seconds === undefined) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

function providerStatus(
  summary: Awaited<ReturnType<typeof getPublicAuditSummary>>,
  providerSlug: string,
  fallback: string
) {
  const provider = summary.providers.find((item) => item.providerSlug === providerSlug);
  if (!provider || provider.windows["24h"].totalRuns === 0) return fallback;
  if (provider.riskFlags.length > 0) return "warning";
  return provider.windows["24h"].uptime >= 0.95 ? "pass" : "warning";
}
